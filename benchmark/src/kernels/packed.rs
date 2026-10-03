//! Shared by `packed` and `rayon-packed`: operand packing, the
//! register-blocked micro-kernel, and the loop over one strip of C.
//!
//! The `ikj` inner loop loads B, loads C and stores C for every vector
//! multiply-add, so the L1 load/store ports cap it near a third of FMA peak.
//! Here an MR × nr block of C stays in registers for a whole k-block, and
//! both operands are copied into k-major strips the micro-kernel reads in
//! order, so FMA throughput becomes the limit.

use crate::Element;
use crate::element::Lanes;
use crate::kernels::Param;

/// Rows of C per micro-kernel block.
pub(crate) const MR: usize = 8;

/// Vectors per block row. MR × NR_VECS = 24 accumulators, plus 3 B vectors
/// and 1 A splat: 28 of the 32 NEON registers.
pub(crate) const NR_VECS: usize = 3;

/// Most lanes of any element type (`f16`), which sizes the write-back buffer.
const MAX_LANES: usize = 8;

/// Columns per micro-kernel block: 12 for f32/i32, 24 for f16, 6 for f64/i64.
fn nr<T: Element>() -> usize {
    NR_VECS * T::Vector::LANES
}

/// The knobs both packed kernels record at size `n`: the requested k-block
/// depth, the depth the blocks actually use, and the register block.
pub(crate) fn params<T: Element>(depth_block: usize, n: usize) -> Vec<Param> {
    vec![
        Param::swept("depth_block", depth_block),
        Param::derived("depth_block_used", depth_block.min(n)),
        Param::derived("register_cols", nr::<T>()),
        Param::fixed("register_rows", MR),
        Param::fixed("register_col_vectors", NR_VECS),
    ]
}

/// Packs rows `pc..pc + kc` of the n×n `rhs` into nr-wide strips, each
/// k-major: `strip[k * nr + c] = rhs[pc + k][j0 + c]`. The last strip is
/// zero-padded past column n.
pub(crate) fn pack_b<T: Element>(rhs: &[T], n: usize, pc: usize, kc: usize, packed: &mut Vec<T>) {
    let nr = nr::<T>();
    packed.clear();
    for j0 in (0..n).step_by(nr) {
        let width = nr.min(n - j0);
        for row in rhs[pc * n..(pc + kc) * n].chunks_exact(n) {
            packed.extend_from_slice(&row[j0..j0 + width]);
            packed.resize(packed.len() + nr - width, T::default());
        }
    }
}

/// Packs columns `pc..pc + kc` of the MR rows of `lhs` starting at `row0`,
/// k-major: `strip[k * MR + r] = lhs[row0 + r][pc + k]`. Rows past n are zero.
pub(crate) fn pack_a<T: Element>(
    lhs: &[T],
    n: usize,
    row0: usize,
    pc: usize,
    kc: usize,
    packed: &mut Vec<T>,
) {
    packed.clear();
    packed.resize(kc * MR, T::default());
    for (r, row) in lhs[row0 * n..].chunks_exact(n).take(MR).enumerate() {
        for (k, &value) in row[pc..pc + kc].iter().enumerate() {
            packed[k * MR + r] = value;
        }
    }
}

/// Adds `a_strip · b_panel` into `c_rows`, the up-to-MR rows of C that
/// `a_strip` was packed from, one MR × nr block at a time.
pub(crate) fn multiply_strip<T: Element>(a_strip: &[T], b_panel: &[T], n: usize, c_rows: &mut [T]) {
    const { assert!(T::Vector::LANES <= MAX_LANES) };
    let (nr, lanes) = (nr::<T>(), T::Vector::LANES);
    let kc = a_strip.len() / MR;
    let mut row_buffer = [T::default(); NR_VECS * MAX_LANES];

    for (b_strip, j0) in b_panel.chunks_exact(kc * nr).zip((0..n).step_by(nr)) {
        let acc = micro_kernel::<T>(a_strip, b_strip);
        // Padded rows and columns computed zeros; only the ones inside C land.
        let cols = nr.min(n - j0);
        for (acc_row, c_row) in acc.iter().zip(c_rows.chunks_exact_mut(n)) {
            for (v, &vector) in acc_row.iter().enumerate() {
                vector.store(&mut row_buffer[v * lanes..]);
            }
            for (c, &sum) in c_row[j0..j0 + cols].iter_mut().zip(&row_buffer) {
                *c += sum;
            }
        }
    }
}

/// One MR × nr block of `A · B` over a k-block, held in registers:
/// `acc[r][v] = Σ_k a_strip[k * MR + r] · b_strip[k * nr + v * lanes ..][..lanes]`.
// ponytail: must inline into `multiply_strip`, or the 24 accumulators
// round-trip through memory on every call.
#[inline(always)]
fn micro_kernel<T: Element>(a_strip: &[T], b_strip: &[T]) -> [[T::Vector; NR_VECS]; MR] {
    let lanes = T::Vector::LANES;
    let mut acc = [[T::Vector::splat(T::default()); NR_VECS]; MR];
    let (a_rows, _) = a_strip.as_chunks::<MR>();
    for (a, b) in a_rows.iter().zip(b_strip.chunks_exact(NR_VECS * lanes)) {
        let b: [T::Vector; NR_VECS] = std::array::from_fn(|v| T::Vector::load(&b[v * lanes..]));
        for (acc_row, &a_r) in acc.iter_mut().zip(a) {
            let a_r = T::Vector::splat(a_r);
            for (acc_v, &b_v) in acc_row.iter_mut().zip(&b) {
                *acc_v = a_r.mul_add(b_v, *acc_v);
            }
        }
    }
    acc
}

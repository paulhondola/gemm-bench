# Packed `std::simd` Micro-Kernel (`packed`, `rayon-packed`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a serial `packed` kernel and a parallel `rayon-packed` kernel. Both are GotoBLAS/BLIS-style GEMMs whose `std::simd` micro-kernel keeps an 8-row × 3-vector block of C in NEON registers, so the CPU kernels become bound by FMA throughput instead of by L1 load/store ports.

**Architecture:** `Element` gains an associated `Vector` type (`Simd<T, lanes>`, one 128-bit register) through a small public `Lanes<T>` trait. A shared `pub(crate)` module, `kernels/packed.rs`, holds packing, the micro-kernel, and the loop over one 8-row strip. Two thin kernels drive it:

- `serial/packed.rs` loops over the strips.
- `rayon/packed.rs` uses `par_chunks_mut` over the strips.

`--block-size` sets the k-block depth (KC). The existing sweep plumbing does the rest.

**Tech Stack:**
- Rust nightly (pinned by `rust-toolchain.toml`), with `#![feature(portable_simd)]`
- rayon 1.12
- just, lefthook
- bun (dashboard docs tests)

**Spec:** `docs/superpowers/specs/2026-09-30-packed-simd-kernel-design.md`

## Global Constraints

- **Kernel labels:** `packed` and `rayon-packed`. CLI values come from `KernelChoice::Packed` and `KernelChoice::RayonPacked` via clap's kebab-case.
- **All five precisions:** `f16`, `f32`, `f64`, `i32`, `i64`. Lane counts: `f16 => 8`, `f32 => 4`, `f64 => 2`, `i32 => 4`, `i64 => 2`.
- **Block shape:** `MR = 8` rows and `NR_VECS = 3` vectors. KC = `--block-size`, and the last k-block is `kc = min(KC, n − pc)`.
- **FMA is required:** floats use `StdFloat::mul_add`; ints use `a * b + acc`.
- **Keep `serial::IkjGemm` untouched.** It is every kernel's correctness reference.
- **Lefthook** runs `cargo fmt` (auto-staged), `cargo clippy --all-targets --all-features -- -D warnings`, and the full `cargo test` on every commit that touches `*.rs`.
  - Never pass `--no-verify`.
  - A task commits only when everything is green, so don't commit a failing test on its own.
- **Throwaway benchmark output** goes to `--output "$SCRATCH/<name>.csv"`, where `SCRATCH` is the session scratchpad (or `/tmp`, per CLAUDE.md). **Never write to `data/runs/`.**
- **Not in this plan:** dashboard palette changes and committed run CSVs. Both are follow-ups (spec, "Follow-ups").
- **Deviation from the spec:** the spec's local `cargo clippy --target aarch64-unknown-linux-gnu` check cannot run here, even on `main`. `swift-rs`'s build script panics on "unexpected target operating system". CI's Linux clippy job covers the non-macOS shape instead (Task 5, Step 6).
- **Prototype evidence (2026-09-30).** The code in Tasks 1–3 was compiled, linted, and tested in a throwaway crate on the pinned nightly:
  - `packed` f32, 1 thread: 88 GOPS
  - `packed` f64: 44 GOPS
  - `rayon-packed` f32, 8 threads: 575 GOPS
  - f32 hot loop: 24 `fmla.4s`, no `[sp` references

  If a step's output differs sharply from these numbers, stop and investigate. Don't tune.

---

### Task 1: `Element::Vector` and the `Lanes` trait

**Files:**
- Modify: `benchmark/src/lib.rs` (feature attributes)
- Modify: `benchmark/src/element.rs` (whole file; current version is 57 lines)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2–3):
  ```rust
  pub trait Lanes<T>: Copy {
      const LANES: usize;
      fn splat(value: T) -> Self;
      fn load(slice: &[T]) -> Self;          // first LANES elements
      fn store(self, slice: &mut [T]);       // first LANES elements
      fn mul_add(self, b: Self, acc: Self) -> Self; // self * b + acc
  }
  // on Element:
  type Vector: Lanes<Self>;
  ```
  It is reachable as `crate::element::Lanes` and `gemm_bench::element::Lanes`. In generic code, write `T::Vector::LANES`, `T::Vector::splat(x)`, and so on.

- [ ] **Step 1: Write the failing test**

Append to the end of `benchmark/src/element.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{Element, Lanes};

    /// `Vector` is exactly one 128-bit register, and `mul_add` is lane-wise
    /// `self * b + acc`: 2 · [0, 1, 2, …] + 1 = [1, 3, 5, …].
    fn vector_is_one_register_with_lane_wise_mul_add<T: Element>() {
        let lanes = T::Vector::LANES;
        assert_eq!(lanes * size_of::<T>(), 16);

        let ramp: Vec<T> = (0..lanes).map(|i| T::from_ratio(i, 1)).collect();
        let (one, two) = (T::from_ratio(1, 1), T::from_ratio(2, 1));
        let mut out = vec![T::default(); lanes];
        T::Vector::splat(two)
            .mul_add(T::Vector::load(&ramp), T::Vector::splat(one))
            .store(&mut out);

        let out: Vec<f64> = out.into_iter().map(Element::to_f64).collect();
        let expected: Vec<f64> = (0..lanes).map(|i| (2 * i + 1) as f64).collect();
        assert_eq!(out, expected);
    }

    #[test]
    fn every_element_vector_is_one_register_with_lane_wise_mul_add() {
        vector_is_one_register_with_lane_wise_mul_add::<f16>();
        vector_is_one_register_with_lane_wise_mul_add::<f32>();
        vector_is_one_register_with_lane_wise_mul_add::<f64>();
        vector_is_one_register_with_lane_wise_mul_add::<i32>();
        vector_is_one_register_with_lane_wise_mul_add::<i64>();
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib element`

Expected: a compile error. `Lanes` is unresolved in `super`, and `T::Vector` is not an associated type of `Element`.

- [ ] **Step 3: Enable `portable_simd`**

In `benchmark/src/lib.rs`, replace:

```rust
#![feature(f16)]
```

with:

```rust
#![feature(f16)]
#![feature(portable_simd)]
```

- [ ] **Step 4: Implement `Lanes` and `Element::Vector`**

Replace everything in `benchmark/src/element.rs` above the `#[cfg(test)]` module added in Step 1 with:

```rust
use std::ops::{Add, AddAssign, Mul};
use std::simd::{Simd, StdFloat};

/// A numeric element type the kernels can multiply.
///
/// `Default` supplies zero for clearing outputs and starting sums. `EPSILON`
/// and the conversions let callers build inputs and compare results
/// independently of precision.
pub trait Element:
    Copy + Default + Send + Sync + Add<Output = Self> + Mul<Output = Self> + AddAssign + 'static
{
    /// Machine epsilon of the element type, widened to `f64`. Zero for
    /// integers, whose products are exact in any summation order.
    const EPSILON: f64;

    /// One 128-bit NEON register of this type, the unit the `packed`
    /// kernels compute in.
    type Vector: Lanes<Self>;

    /// Builds an input value from `numerator / denominator`. Integers keep
    /// only the numerator, since the fraction would truncate to zero.
    fn from_ratio(numerator: usize, denominator: usize) -> Self;

    fn to_f64(self) -> f64;
}

/// A SIMD vector of `LANES` elements of `T`. Public because `Element` names
/// it; only the `packed` kernels use it.
pub trait Lanes<T>: Copy {
    const LANES: usize;

    fn splat(value: T) -> Self;

    /// Reads the first `LANES` elements of `slice`.
    fn load(slice: &[T]) -> Self;

    /// Writes the first `LANES` elements of `slice`.
    fn store(self, slice: &mut [T]);

    /// `self * b + acc`, fused (one rounding) for floats.
    fn mul_add(self, b: Self, acc: Self) -> Self;
}

/// `Lanes` for `Simd<$ty, $lanes>`; only the multiply-add differs by type.
macro_rules! impl_lanes {
    ($ty:ty, $lanes:literal, |$a:ident, $b:ident, $acc:ident| $mul_add:expr) => {
        impl Lanes<$ty> for Simd<$ty, $lanes> {
            const LANES: usize = $lanes;

            #[inline]
            fn splat(value: $ty) -> Self {
                Simd::splat(value)
            }

            #[inline]
            fn load(slice: &[$ty]) -> Self {
                Simd::from_slice(slice)
            }

            #[inline]
            fn store(self, slice: &mut [$ty]) {
                self.copy_to_slice(slice);
            }

            #[inline]
            fn mul_add(self, $b: Self, $acc: Self) -> Self {
                let $a = self;
                $mul_add
            }
        }
    };
}

macro_rules! impl_element {
    (float: $($float:ty => $lanes:literal),*) => {
        $(
            impl Element for $float {
                const EPSILON: f64 = <$float>::EPSILON as f64;
                type Vector = Simd<$float, $lanes>;

                fn from_ratio(numerator: usize, denominator: usize) -> Self {
                    (numerator as f64 / denominator as f64) as $float
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }

            impl_lanes!($float, $lanes, |a, b, acc| StdFloat::mul_add(a, b, acc));
        )*
    };
    (int: $($int:ty => $lanes:literal),*) => {
        $(
            impl Element for $int {
                const EPSILON: f64 = 0.0;
                type Vector = Simd<$int, $lanes>;

                // ponytail: no overflow check; benchmark outputs peak at 616·n,
                // far inside i32 for any n that fits in memory.
                fn from_ratio(numerator: usize, _denominator: usize) -> Self {
                    numerator as $int
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }

            // LLVM fuses this into `mla` for i32; NEON has no 64-bit multiply,
            // so i64 multiplies lane by lane in scalar registers.
            impl_lanes!($int, $lanes, |a, b, acc| a * b + acc);
        )*
    };
}

// One 128-bit NEON register each.
impl_element!(float: f16 => 8, f32 => 4, f64 => 2);
impl_element!(int: i32 => 4, i64 => 2);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib element`

Expected: PASS, `every_element_vector_is_one_register_with_lane_wise_mul_add ... ok`.

- [ ] **Step 6: Run the full gate**

Run: `just check-bench && just test-bench`

Expected: clippy clean, and every test passes. No kernel uses `Vector` yet, and nothing else changes.

- [ ] **Step 7: Commit**

```bash
git add benchmark/src/lib.rs benchmark/src/element.rs
git commit -m "$(cat <<'EOF'
Give every Element a one-register std::simd vector type

Lanes<T> (splat, load, store, fused mul_add) over Simd<T, lanes>, sized
to one 128-bit NEON register per precision, for the packed kernels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared packing and micro-kernel, and the serial `packed` kernel

**Files:**
- Create: `benchmark/src/kernels/packed.rs`
- Create: `benchmark/src/kernels/serial/packed.rs`
- Modify: `benchmark/src/kernels/serial/mod.rs`
- Modify: `benchmark/src/kernels/mod.rs` (module list, re-exports, tests)

**Interfaces:**
- Consumes: `Element::Vector`, and `Lanes::{LANES, splat, load, store, mul_add}` from Task 1.
- Produces (used by Tasks 3–4):
  ```rust
  // kernels/packed.rs (pub(crate))
  pub(crate) const MR: usize = 8;
  pub(crate) fn pack_b<T: Element>(rhs: &[T], n: usize, pc: usize, kc: usize, packed: &mut Vec<T>);
  pub(crate) fn pack_a<T: Element>(lhs: &[T], n: usize, row0: usize, pc: usize, kc: usize, packed: &mut Vec<T>);
  pub(crate) fn multiply_strip<T: Element>(a_strip: &[T], b_panel: &[T], n: usize, c_rows: &mut [T]);
  // kernels::PackedGemm (pub)
  pub struct PackedGemm { block_size: usize }
  impl PackedGemm { pub fn new(block_size: usize) -> Self }  // panics on 0
  impl<T: Element> GemmKernel<T> for PackedGemm
  ```

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernels/mod.rs`, inside `mod tests`, replace the import block:

```rust
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm,
        StaticTiledGemm, TiledGemm,
    };
```

with:

```rust
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, PackedGemm, RayonIkjGemm, RayonTiledGemm,
        StaticIkjGemm, StaticTiledGemm, TiledGemm,
    };
```

In `every_kernel_matches_naive`, replace:

```rust
        let mut kernels: Vec<Box<dyn GemmKernel<T>>> = vec![
            Box::new(IkjGemm),
            Box::new(TiledGemm::new(3)),
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
        ];
```

with:

```rust
        let mut kernels: Vec<Box<dyn GemmKernel<T>>> = vec![
            Box::new(IkjGemm),
            Box::new(TiledGemm::new(3)),
            Box::new(PackedGemm::new(3)),
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
        ];
```

Directly after the `every_kernel_matches_naive_on_a_non_tile_aligned_matrix` test function, which ends with `every_kernel_matches_naive::<i64>();` and `}`, insert:

```rust

    /// n = 37 with a 16-deep k-block splits every dimension into full and
    /// partial packed blocks: rows 4×8 + 5; columns 3×12 + 1 (f32, i32),
    /// 24 + 13 (f16), 6×6 + 1 (f64, i64); k 2×16 + 5. n = 7 alone never fills
    /// a whole 8-row block.
    fn packed_matches_naive<T: Element>() {
        let n = 37;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let mut actual = Matrix::zeros(n, n);
        PackedGemm::new(16).compute(&lhs, &rhs, &mut actual);
        assert_close(&actual, &expected);
    }

    #[test]
    fn packed_kernels_match_naive_across_full_and_partial_blocks() {
        packed_matches_naive::<f16>();
        packed_matches_naive::<f32>();
        packed_matches_naive::<f64>();
        packed_matches_naive::<i32>();
        packed_matches_naive::<i64>();
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib kernels::tests`

Expected: a compile error, because `PackedGemm` is unresolved in `super`.

- [ ] **Step 3: Create the shared module**

Create `benchmark/src/kernels/packed.rs`:

```rust
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

/// Rows of C per micro-kernel block.
pub(crate) const MR: usize = 8;

/// Vectors per block row. MR × NR_VECS = 24 accumulators, plus 3 B vectors
/// and 1 A splat: 28 of the 32 NEON registers.
const NR_VECS: usize = 3;

/// Most lanes of any element type (`f16`), which sizes the write-back buffer.
const MAX_LANES: usize = 8;

/// Columns per micro-kernel block: 12 for f32/i32, 24 for f16, 6 for f64/i64.
fn nr<T: Element>() -> usize {
    NR_VECS * T::Vector::LANES
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
```

Notes for the implementer:
- `as_chunks::<MR>()` is deliberate. Clippy's `chunks_exact_to_as_chunks` rejects `chunks_exact(MR)` with a constant size, and the fixed-size `&[T; 8]` chunks let LLVM drop bounds checks.
- The `const { assert!(…) }` is evaluated once per monomorphized `T`. Any type with more than 8 lanes fails to compile instead of panicking at run time.

- [ ] **Step 4: Create the serial kernel**

Create `benchmark/src/kernels/serial/packed.rs`:

```rust
use crate::kernels::packed::{MR, multiply_strip, pack_a, pack_b};
use crate::kernels::{GemmKernel, assert_gemm_dimensions};
use crate::{Element, Matrix};

/// Sequential packed GEMM: operands copied into k-major strips, multiplied by
/// a `std::simd` micro-kernel that keeps an 8-row block of C in registers.
/// The block size is the k-block (KC), the depth of each packed B panel.
pub struct PackedGemm {
    block_size: usize,
}

impl PackedGemm {
    #[must_use]
    pub fn new(block_size: usize) -> Self {
        assert!(block_size > 0, "block size must be greater than zero");
        Self { block_size }
    }
}

impl<T: Element> GemmKernel<T> for PackedGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        output.as_mut_slice().fill(T::default());
        let (mut packed_a, mut packed_b) = (Vec::new(), Vec::new());

        for pc in (0..n).step_by(self.block_size) {
            let kc = self.block_size.min(n - pc);
            pack_b(rhs.as_slice(), n, pc, kc, &mut packed_b);
            for (strip, c_rows) in output.as_mut_slice().chunks_mut(MR * n).enumerate() {
                pack_a(lhs.as_slice(), n, strip * MR, pc, kc, &mut packed_a);
                multiply_strip(&packed_a, &packed_b, n, c_rows);
            }
        }
    }
}
```

- [ ] **Step 5: Register the modules**

Replace `benchmark/src/kernels/serial/mod.rs` with:

```rust
mod ikj;
mod naive;
mod packed;
mod tiled;

pub use ikj::IkjGemm;
pub use naive::NaiveGemm;
pub use packed::PackedGemm;
pub use tiled::TiledGemm;
```

In `benchmark/src/kernels/mod.rs`, replace:

```rust
#[cfg(target_os = "macos")]
pub mod metal;
pub mod rayon;
```

with:

```rust
#[cfg(target_os = "macos")]
pub mod metal;
pub(crate) mod packed;
pub mod rayon;
```

and replace:

```rust
pub use serial::{IkjGemm, NaiveGemm, TiledGemm};
```

with:

```rust
pub use serial::{IkjGemm, NaiveGemm, PackedGemm, TiledGemm};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib kernels::tests`

Expected: PASS, including:
- `every_kernel_matches_naive_on_a_non_tile_aligned_matrix`
- `packed_kernels_match_naive_across_full_and_partial_blocks`

- [ ] **Step 7: Check that the new test has teeth (then revert)**

In `benchmark/src/kernels/packed.rs`, temporarily change `let width = nr.min(n - j0);` to `let width = nr.min(n - j0).min(nr - 1);`.

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib kernels::tests`

Expected: both tests above FAIL with `element …: expected …, got …`.

Revert the change, run again, and expect PASS.

- [ ] **Step 8: Run the full gate**

Run: `just check-bench && just test-bench`

Expected: clippy clean and all tests pass. `kernel.rs` is untouched, so the CLI does not know `packed` yet. That's Task 4.

- [ ] **Step 9: Commit**

```bash
git add benchmark/src/kernels/packed.rs benchmark/src/kernels/serial/packed.rs benchmark/src/kernels/serial/mod.rs benchmark/src/kernels/mod.rs
git commit -m "$(cat <<'EOF'
Add the packed kernel: k-major packing and a std::simd micro-kernel

An 8 x 3-vector block of C stays in NEON registers for a whole k-block
(24 FMAs per 3 B loads), so the kernel is FMA-bound instead of limited
by the L1 load/store ports that cap ikj near a third of peak. Zero-padded
packing keeps every edge out of the micro-kernel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The parallel `rayon-packed` kernel

**Files:**
- Create: `benchmark/src/kernels/rayon/packed.rs`
- Modify: `benchmark/src/kernels/rayon/mod.rs`
- Modify: `benchmark/src/kernels/mod.rs` (re-export, tests)

**Interfaces:**
- Consumes, from Task 2: `crate::kernels::packed::{MR, pack_a, pack_b, multiply_strip}`, with the signatures listed in Task 2's Interfaces.
- Produces (used by Task 4):
  ```rust
  pub struct RayonPackedGemm { block_size: usize }
  impl RayonPackedGemm { pub fn new(block_size: usize) -> Self }  // panics on 0
  impl<T: Element> GemmKernel<T> for RayonPackedGemm  // runs in the caller's Rayon pool
  ```

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernels/mod.rs`, inside `mod tests`, replace the import block:

```rust
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, PackedGemm, RayonIkjGemm, RayonTiledGemm,
        StaticIkjGemm, StaticTiledGemm, TiledGemm,
    };
```

with:

```rust
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, PackedGemm, RayonIkjGemm, RayonPackedGemm,
        RayonTiledGemm, StaticIkjGemm, StaticTiledGemm, TiledGemm,
    };
```

In `every_kernel_matches_naive`, replace:

```rust
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
        ];
```

with:

```rust
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
            Box::new(RayonPackedGemm::new(3)),
        ];
```

Replace the whole `packed_matches_naive` helper (its doc comment through its closing `}`) with:

```rust
    /// n = 37 with a 16-deep k-block splits every dimension into full and
    /// partial packed blocks: rows 4×8 + 5; columns 3×12 + 1 (f32, i32),
    /// 24 + 13 (f16), 6×6 + 1 (f64, i64); k 2×16 + 5. n = 7 alone never fills
    /// a whole 8-row block.
    fn packed_matches_naive<T: Element>() {
        let n = 37;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let mut actual = Matrix::zeros(n, n);
        PackedGemm::new(16).compute(&lhs, &rhs, &mut actual);
        assert_close(&actual, &expected);

        // Three workers, so strips of one k-block run concurrently.
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(3)
            .build()
            .expect("rayon thread pool should build");
        let mut actual = Matrix::zeros(n, n);
        pool.install(|| RayonPackedGemm::new(16).compute(&lhs, &rhs, &mut actual));
        assert_close(&actual, &expected);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib kernels::tests`

Expected: a compile error, because `RayonPackedGemm` is unresolved in `super`.

- [ ] **Step 3: Create the parallel kernel**

Create `benchmark/src/kernels/rayon/packed.rs`:

```rust
use rayon::prelude::*;

use crate::kernels::packed::{MR, multiply_strip, pack_a, pack_b};
use crate::kernels::{GemmKernel, assert_gemm_dimensions};
use crate::{Element, Matrix};

/// `packed` with Rayon work stealing over its 8-row strips of C. Each k-block's
/// packed B panel is shared read-only by every task.
pub struct RayonPackedGemm {
    block_size: usize,
}

impl RayonPackedGemm {
    #[must_use]
    pub fn new(block_size: usize) -> Self {
        assert!(block_size > 0, "block size must be greater than zero");
        Self { block_size }
    }
}

impl<T: Element> GemmKernel<T> for RayonPackedGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        output.as_mut_slice().fill(T::default());
        let mut packed_b = Vec::new();

        for pc in (0..n).step_by(self.block_size) {
            let kc = self.block_size.min(n - pc);
            // ponytail: B is packed on the calling thread, an estimated ~5% of
            // the run at n = 4096; parallelize it if a profile shows it.
            pack_b(rhs.as_slice(), n, pc, kc, &mut packed_b);
            output
                .as_mut_slice()
                .par_chunks_mut(MR * n)
                .enumerate()
                // One A buffer per Rayon split, reused across its strips.
                .for_each_init(Vec::new, |packed_a, (strip, c_rows)| {
                    pack_a(lhs.as_slice(), n, strip * MR, pc, kc, packed_a);
                    multiply_strip(packed_a, &packed_b, n, c_rows);
                });
        }
    }
}
```

- [ ] **Step 4: Register the module**

Replace `benchmark/src/kernels/rayon/mod.rs` with:

```rust
mod ikj;
mod packed;
mod tiled;

pub use ikj::RayonIkjGemm;
pub use packed::RayonPackedGemm;
pub use tiled::RayonTiledGemm;
```

In `benchmark/src/kernels/mod.rs`, replace:

```rust
pub use rayon::{RayonIkjGemm, RayonTiledGemm};
```

with:

```rust
pub use rayon::{RayonIkjGemm, RayonPackedGemm, RayonTiledGemm};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib kernels::tests`

Expected: PASS, including:
- `every_kernel_matches_naive_on_a_non_tile_aligned_matrix`
- `packed_kernels_match_naive_across_full_and_partial_blocks`

- [ ] **Step 6: Run the full gate**

Run: `just check-bench && just test-bench`

Expected: clippy clean and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add benchmark/src/kernels/rayon/packed.rs benchmark/src/kernels/rayon/mod.rs benchmark/src/kernels/mod.rs
git commit -m "$(cat <<'EOF'
Add rayon-packed: the packed kernel over work-stolen 8-row strips

Each k-block's B panel is packed once and shared read-only; every Rayon
split reuses one A buffer (for_each_init).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CLI, harness, README, and dashboard docs

**Files:**
- Modify: `benchmark/src/kernel.rs` (`KernelChoice` enum and `KernelChoice::info`)
- Modify: `benchmark/src/benchmark.rs` (import, and two `measure` arms)
- Modify: `README.md` (CPU kernel table, `--kernel` row, `--block-size` row)
- Modify: `web/src/docs/kernels/serial.md` (new `packed` section after `tiled`)
- Modify: `web/src/docs/kernels/parallel.md` (new `rayon-packed` section after `rayon-tiled`)
- Test: `web/src/lib/docs.test.ts` (existing; it fails until both docs sections exist)

**Interfaces:**
- Consumes: `gemm_bench::kernels::{PackedGemm, RayonPackedGemm}`, both `::new(block_size: usize)`, from Tasks 2–3.
- Produces: the CLI values `--kernel packed` and `--kernel rayon-packed`, and CSV `kernel` labels `packed` and `rayon-packed`, with `block_size` recorded.

- [ ] **Step 1: Register the kernels in `kernel.rs`**

In the `KernelChoice` enum, replace:

```rust
    Ikj,
    Tiled,
    RayonIkj,
    RayonTiled,
```

with:

```rust
    Ikj,
    Tiled,
    Packed,
    RayonIkj,
    RayonTiled,
    RayonPacked,
```

In `KernelChoice::info`, replace:

```rust
            Self::Tiled => KernelInfo {
                blocks: true,
                ..serial("tiled")
            },
```

with:

```rust
            Self::Tiled => KernelInfo {
                blocks: true,
                ..serial("tiled")
            },
            // `--block-size` is the k-block depth (KC) of each packed B panel.
            Self::Packed => KernelInfo {
                blocks: true,
                ..serial("packed")
            },
```

and replace:

```rust
            Self::RayonTiled => KernelInfo {
                workers: true,
                blocks: true,
                ..serial("rayon-tiled")
            },
```

with:

```rust
            Self::RayonTiled => KernelInfo {
                workers: true,
                blocks: true,
                ..serial("rayon-tiled")
            },
            Self::RayonPacked => KernelInfo {
                workers: true,
                blocks: true,
                ..serial("rayon-packed")
            },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo build --manifest-path benchmark/Cargo.toml`

Expected: error `E0004` (non-exhaustive patterns: `KernelChoice::Packed` and `KernelChoice::RayonPacked` not covered) in `measure` in `benchmark.rs`.

Run: `cd web && bun test src/lib/docs.test.ts`

Expected: FAIL in "the catalogue documents exactly the kernels in kernel.rs", because `packed` and `rayon-packed` are missing from the documented list.

- [ ] **Step 3: Wire the harness in `benchmark.rs`**

Replace the import:

```rust
    kernels::{
        IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm, StaticTiledGemm, TiledGemm,
    },
```

with:

```rust
    kernels::{
        IkjGemm, NaiveGemm, PackedGemm, RayonIkjGemm, RayonPackedGemm, RayonTiledGemm,
        StaticIkjGemm, StaticTiledGemm, TiledGemm,
    },
```

In `measure`, replace:

```rust
        KernelChoice::Tiled => sample(&TiledGemm::new(block()), setup_start, io),
```

with:

```rust
        KernelChoice::Tiled => sample(&TiledGemm::new(block()), setup_start, io),
        KernelChoice::Packed => sample(&PackedGemm::new(block()), setup_start, io),
```

and replace:

```rust
        KernelChoice::RayonTiled => sample(
            &InPool::new(threads, RayonTiledGemm::new(block()))?,
            setup_start,
            io,
        ),
```

with:

```rust
        KernelChoice::RayonTiled => sample(
            &InPool::new(threads, RayonTiledGemm::new(block()))?,
            setup_start,
            io,
        ),
        KernelChoice::RayonPacked => sample(
            &InPool::new(threads, RayonPackedGemm::new(block()))?,
            setup_start,
            io,
        ),
```

- [ ] **Step 4: Document the serial kernel**

In `web/src/docs/kernels/serial.md`, directly after the `tiled` section's last line (`- **Source:** [`benchmark/src/kernels/serial/tiled.rs`](…)`), insert:

````markdown

## `packed`

The GotoBLAS/BLIS design. For each k-block, B is copied into narrow k-major strips and each 8-row strip of A into a k-major buffer. A `std::simd` micro-kernel then keeps an 8 × 3-vector block of C in registers for the whole k-block and adds it into C once. `ikj` loads and stores C for every multiply-add, which caps it near a third of peak; here C stays in registers, so the multiply-add units become the limit.

```text
C = 0
for kk in steps of b:                    # b = block size: the k-block depth
  pack B[kk..kk+b][*] into strips 3 vectors wide
  for each 8-row strip i of C:
    pack A[i..i+8][kk..kk+b]
    for each B strip j:
      acc = 0                            # 8 × 3 vectors, in registers
      for k in kk..kk+b:
        acc += A[i..i+8][k] ⊗ B[k][j]    # 24 fused multiply-adds
      C[i..i+8][j] += acc
```

- **Runs via:** Portable SIMD (`std::simd`) on one core: one 128-bit NEON register per vector, with fused multiply-add for floats.
- **Tunes:** Block size, as the depth of each packed k-block.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** `i64` gains little: NEON has no 64-bit integer multiply, so each lane multiplies in a scalar register. Floats round once per multiply-add instead of twice, so results differ slightly from `ikj`'s.
- **Source:** [`benchmark/src/kernels/serial/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/packed.rs), with the shared packing and micro-kernel in [`benchmark/src/kernels/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/packed.rs)
````

- [ ] **Step 5: Document the parallel kernel**

In `web/src/docs/kernels/parallel.md`, directly after the `rayon-tiled` section's last line (`- **Source:** [`benchmark/src/kernels/rayon/tiled.rs`](…)`), insert:

````markdown

## `rayon-packed`

`packed`, with its 8-row strips of C spread across threads by Rayon work stealing. Each k-block's B panel is packed once, on the calling thread, and shared read-only by every worker; each worker packs its own strips of A.

```text
C = 0
for kk in steps of b:
  pack B[kk..kk+b][*] into strips       # once, shared
  parallel for each 8-row strip i:      # Rayon work stealing
    pack A[i..i+8][kk..kk+b]
    for each B strip j:
      C[i..i+8][j] += micro-kernel(A strip, B strip)
```

- **Runs via:** A Rayon parallel iterator over the 8-row strips, on a pool built before timing starts, with the `packed` micro-kernel on each core.
- **Tunes:** Thread count and block size (the k-block depth).
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** B is packed on one thread between parallel rounds, a small serial share of each run. At small N there are few strips to share: N / 8, so 8 at N = 64.
- **Source:** [`benchmark/src/kernels/rayon/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/rayon/packed.rs)
````

- [ ] **Step 6: Update the README**

In the `### CPU` kernel table, directly after the row that starts ``| `tiled` |``, insert:

```markdown
| `packed` | Packed operands + `std::simd` register-blocked micro-kernel (GotoBLAS/BLIS) | Copies each k-block of B and each 8-row strip of A into k-major buffers, then keeps an 8 × 3-vector block of C in NEON registers for the whole k-block: 24 fused multiply-adds per 3 B loads, so it is bound by FMA throughput rather than the L1 load/store ports that cap `ikj`. `--block-size` sets the k-block depth. |
```

Directly after the row that starts ``| `rayon-tiled` |``, insert:

```markdown
| `rayon-packed` | `packed` with Rayon work stealing | Spreads `packed`'s 8-row strips of C across a Rayon pool; each k-block's packed B panel is shared read-only by every worker. |
```

In the `--kernel` option row, replace:

```
(`naive`, `ikj`, `tiled`, `rayon-ikj`, `rayon-tiled`, `static-ikj`,
```

with:

```
(`naive`, `ikj`, `tiled`, `packed`, `rayon-ikj`, `rayon-tiled`, `rayon-packed`, `static-ikj`,
```

In the `--block-size` option row, replace:

```
Tile edge length(s) for the tiled kernels (`tiled`, `rayon-tiled`, `static-tiled`), comma-delimited.
```

with:

```
Tile edge length(s) for the tiled kernels (`tiled`, `rayon-tiled`, `static-tiled`) and the k-block depth of `packed` and `rayon-packed`, comma-delimited.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo build --manifest-path benchmark/Cargo.toml`

Expected: builds clean.

Run: `cd web && bun test src/lib/docs.test.ts`

Expected: 4 pass, 0 fail.

- [ ] **Step 8: Smoke-run every precision through the harness**

Run:

```bash
just bench --sizes 64,257 --kernel ikj,packed,rayon-packed --precision f16,f32,f64,i32,i64 --threads 1,4 --block-size 16,64 --output "$SCRATCH/packed-smoke.csv"
```

Expected:
- The run completes with no accuracy abort. The harness checks every row against `ikj` at 4√N·ε.
- The printed table has `packed` and `rayon-packed` rows at every precision, with `block_size` 16 and 64.
- n=257 is odd on purpose: it gives a partial row strip, a partial column strip, and a short last k-block.

- [ ] **Step 9: Run the full gate**

Run: `just check && just test`

Expected: clippy clean, svelte-check clean, and all Rust and bun tests pass.

- [ ] **Step 10: Commit**

```bash
git add benchmark/src/kernel.rs benchmark/src/benchmark.rs README.md web/src/docs/kernels/serial.md web/src/docs/kernels/parallel.md
git commit -m "$(cat <<'EOF'
Wire packed and rayon-packed into the CLI, harness and docs

--block-size sets their k-block depth, so the existing sweep tunes it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Acceptance, measured against the spec

No new code. This task checks the spec's Acceptance table and records the numbers for the PR description. If a check misses its bar, stop and report. Don't tune.

**Files:** none modified. Outputs go to `$SCRATCH` only.

**Interfaces:**
- Consumes: the `packed` and `rayon-packed` CLI kernels from Task 4.
- Produces: the numbers for the PR description.

- [ ] **Step 1: Assembly: the f32 hot loop is 24 FMAs with no stack traffic**

Run:

```bash
cargo build --release --manifest-path benchmark/Cargo.toml
objdump -d --no-show-raw-insn benchmark/target/release/gemm-bench \
  | awk '/multiply_stripfE.*>:$/ {p=1} p && /^$/ {exit} p' \
  | awk '/fmla.4s/ && !s {s=1} s {print} s && /b\.ne/ {exit}' > "$SCRATCH/packed-loop.s"
grep -c 'fmla.4s' "$SCRATCH/packed-loop.s"
grep -c '\[sp' "$SCRATCH/packed-loop.s"
```

Expected: `24`, then `0`.

How the commands work:
- The first `awk` extracts the f32 instantiation of `multiply_strip`. In v0 mangling, `f` is `f32`.
- The second `awk` keeps the loop from the first `fmla.4s` to its closing `b.ne`.

What to check:
- Stack accesses *after* the loop are expected: that's the write-back storing accumulators into `row_buffer`.
- If the first `awk` prints nothing, LLVM inlined `multiply_strip`. List the candidates with `objdump -d benchmark/target/release/gemm-bench | grep -E '^[0-9a-f]+ <.*[Pp]acked.*>:$'`, and use the f32 `PackedGemm…GemmKernelfE7compute` symbol instead.

- [ ] **Step 2: Single-thread throughput**

Run:

```bash
just bench --sizes 512,1024,2048 --kernel ikj,packed --precision f32 --block-size 64,128,256 --output "$SCRATCH/packed-1t.csv"
```

Expected: the best `packed` row is **≥ 60 GOPS** (the prototype reached ~88), against `ikj` ~25–27. Below 50, go back to Step 1's assembly before anything else.

- [ ] **Step 3: 8-thread throughput**

Run:

```bash
just bench --sizes 512,1024,2048 --kernel rayon-ikj,rayon-packed --precision f32 --threads 8 --block-size 128,256 --output "$SCRATCH/packed-8t.csv"
```

- [ ] **Step 4: Read both runs as % of peak, from `min_ms`**

8-thread medians are noisy on this machine (see memory: measurement noise), so rate these runs from `min_ms`. Run:

```bash
duckdb -c "
select kernel, n, threads, block_size,
       round(gops, 1) as gops_median,
       round(2.0 * n * n * n / min_ms / 1e6, 1) as gops_min,
       round(100 * 2.0 * n * n * n / min_ms / 1e6 / case when threads = 1 then 103.296 else 777.216 end, 1) as pct_peak
from read_csv(['$SCRATCH/packed-1t.csv', '$SCRATCH/packed-8t.csv'], union_by_name = true)
order by kernel, n, block_size"
```

(103.296 and 777.216 are the f32 1-core and 8-core rows of `data/peaks.csv`.)

Expected:
- `packed` best `gops_min` ≥ 60, roughly 58%+ of peak.
- `rayon-packed` best `gops_min` ≥ **400**, roughly 51%+ of peak (the prototype reached ~575, 74%).

- [ ] **Step 5: Final gate on the branch**

Run: `just check && just test`

Expected: all clean.

- [ ] **Step 6: Non-macOS shape (CI)**

After pushing the branch and opening a PR (only when the user asks), confirm that the Linux CI clippy and test jobs pass. They are the only build of `Simd<f16, 8>::mul_add` for x86_64.

If f16 fails to compile or link there, change only the `f16` arm: give `f16` its own `impl_lanes!(f16, 8, |a, b, acc| a * b + acc)` line. Keep the `impl_element!(float: …)` entry for the `Element` part, and record the reason in a comment.

- [ ] **Step 7: HPC review**

Dispatch the `hpc-specialist` agent on `benchmark/src/kernels/packed.rs`, `serial/packed.rs`, and `rayon/packed.rs`, as the `add-kernel` skill recommends. Pass it this task's numbers. Fold in any confirmed issue as its own commit, with the tests green.

- [ ] **Step 8: Report**

Give the user a table of the best rows for `ikj`, `packed`, `rayon-ikj`, and `rayon-packed` (GOPS from `min_ms`, % of peak, and the block size that won), plus the Step 1 assembly counts.

Remind the user of the two follow-ups before any `packed` run lands in `data/runs`:
- the palette slot
- a quiet-machine sweep

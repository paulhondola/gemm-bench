# Packed Micro-Kernel GEMM with `std::simd` (`packed`, `rayon-packed`)

- **Status:** Approved design
- **Supersedes:** `2026-09-16-packed-simd-kernel-design.md` (never implemented). That spec excluded f16 and the parallel variant, made FMA optional, and used BLIS's five loops. The decisions below replace it.

## Problem

Every hand-written CPU kernel sits at **25–31% of the NEON FMA peak** in `data/peaks.csv`, and the fraction is the same for f16, f32, and f64:

- `ikj` f32 reaches 32 GOPS at n=128, and 25–27 GOPS at n=256–4096, against a single-core peak of 103.
- `rayon-ikj` reaches 197 GOPS on 8 threads, against 777.

The curve is flat from n=128 to 4096, so the kernels are bound inside the core, not by the memory hierarchy.

The disassembly of `ikj_rows` shows why. The inner loop is an axpy. For every vector of work it issues `ldp` B, `ldp` C, `fmul`, `fadd`, `stp` C:

- There are 3 L1 accesses per FMA-equivalent.
- The loop runs at ~1.24 vectors/cycle at n=128, which is ~3.7 L1 accesses per cycle. That saturates the load/store ports while the four FP pipes are ~60% busy.
- The ceiling of this loop shape is about ⅓ of peak.
- There is no `fmla`, because Rust never contracts `a*b + c` on floats.

Two things don't help:

- **Tiling.** It keeps the same inner loop, so `tiled` never beats `ikj`.
- **More threads.** Scaling is already ~95% efficient: 7.6× on 8 threads.

The fix is the GotoBLAS/BLIS structure. A register-blocked micro-kernel keeps an MR×NR block of C in NEON registers across the whole `k` loop, which cuts memory traffic from 3 accesses per FMA to ~0.46. Packed operands make both of its inputs unit-stride. With that, the kernel becomes bound by FMA throughput.

## Goals

- Add a serial kernel `packed` and a parallel kernel `rayon-packed`, at all five precisions, written with nightly `std::simd`.
- Reach **≥ 60 GOPS** for `packed` f32 on one thread at n=512–2048, which is ≥ 58% of peak.
- Reach **≥ 400 GOPS** for `rayon-packed` f32 on 8 threads.

## Non-Goals

- **`std::arch` intrinsics or assembly.** Portable SIMD is the point of the exercise.
- **MC/NC cache blocking (BLIS loops 1 and 3).** A full-width B panel fits in L2 up to n=4096 (see Parameters).
- **Per-type MR/NR tuning, autotuning, or new CLI flags.**
- **Dashboard palette.** The host colour group has one free slot (red) and this adds two kernels. It is a follow-up, needed before the first `packed` run file is committed to `data/runs` (see Follow-ups).
- **Committed run data.** The sweep that lands in `data/runs` runs on a quiet machine, and it's the user's call when.

## Design

### Element gets a vector type (`benchmark/src/element.rs`)

```rust
/// A 128-bit NEON-width vector of `T`: one register on AArch64.
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

pub trait Element: /* existing bounds */ {
    type Vector: Lanes<Self>;
    // existing items unchanged
}
```

- `impl_element!` gains a lane count per type: `f16 => 8`, `f32 => 4`, `f64 => 2`, `i32 => 4`, `i64 => 2`. Each type's vector is `Simd<T, LANES>`.
- The float arm implements `mul_add` with `StdFloat::mul_add`. The int arm uses `self * b + acc`, which LLVM fuses into `mla` for i32. For i64 it compiles to scalar `mul`s, because NEON has no 64-bit integer multiply.
- `Lanes` lives in `element.rs`, not in the kernel module. `Element` is public API, so a trait named in its bounds must be public, or `private_bounds` fails clippy.
- `lib.rs` adds `#![feature(portable_simd)]`.

The pinned nightly supports `std::simd` for all five element types. A probe on 2026-09-30 compiled f16×8, f32×4, and f64×2 `mul_add` to `fmla.8h`, `fmla.4s`, and `fmla.2d`, and i32×4 `a*b + c` to `mla.4s`.

### Files

| File | Contents |
|---|---|
| `kernels/packed.rs` (new, `pub(crate)`) | `MR`, `NR_VECS`, `pack_a`, `pack_b`, `micro_kernel`, and the per-strip routine shared by both kernels. |
| `kernels/serial/packed.rs` | `PackedGemm { kc }` |
| `kernels/rayon/packed.rs` | `RayonPackedGemm { kc }` |

Guardrail carried over from the 2026-09-16 spec: if `kernels/packed.rs` grows past ~250 lines, stop and re-scope.

### Loop nest

```
output.fill(0)
for pc in (0..n).step_by(KC):                      // kc = min(KC, n - pc)
    pack_b(rows pc..pc+kc of B) → b_panel           // NR-wide strips, zero-padded
    for each MR-row strip of C:                     // rayon-packed: par_chunks_mut
        pack_a(strip rows of A, cols pc..pc+kc) → a_strip   // zero-padded rows
        for each NR-wide strip jr of b_panel:
            acc = micro_kernel(kc, a_strip, b_strip)
            add acc into C[strip rows, jr..]        // clipped to n
```

### Parameters

- **MR = 8 rows and NR_VECS = 3 vectors**, so `nr = 3 × LANES`:
  - f32/i32: 8×12
  - f16: 8×24
  - f64/i64: 8×6

  That is always 24 accumulators, 3 B vectors, and 1 A splat: 28 of 32 NEON registers. 24 independent accumulators exceed the 16 FMAs in flight that 4 pipes × ~4-cycle latency need.
- **KC = `--block-size`.** Both kernels set `blocks: true` and inherit the existing sweep (16, 32, 64, 128, 256).
  - At KC=256 f32, the A strip (8 KB) and one B strip (12 KB) sit in the 128 KB L1.
  - The B panel (KC × n) is 4 MB at n=4096 f32 and 8 MB at f64, inside the 12 MB P-cluster L2.

### Packing

Both layouts are k-major, so the micro-kernel reads each operand sequentially:

```
a_strip[k * MR + r]        = A[row0 + r][pc + k]    // 0 where row0 + r ≥ n
b_panel[strip][k * nr + c] = B[pc + k][j0 + c]      // 0 where j0 + c ≥ n
```

- The buffers are `Vec<T>`s reused across `pc` steps: `clear()` then refill.
- Buffer allocation and packing both count in the timed region, as they do in real BLAS.
- Packing is O(n²) in total.

### Edges

The micro-kernel always computes a full MR×nr block:

| Edge | Handled by |
|---|---|
| fewer than MR rows left | `pack_a` pads with zero rows. The write-back skips them. |
| fewer than nr columns left | `pack_b` pads with zero columns. The write-back clips. |
| fewer than KC left in `k` | The micro-kernel loops `kc` times. No padding. |

### Micro-kernel

```rust
#[inline(always)] // must inline into the jr loop, or `acc` round-trips through memory
fn micro_kernel<T: Element>(kc: usize, a_strip: &[T], b_strip: &[T]) -> [[T::Vector; NR_VECS]; MR]
```

- Walk `k` with `a_strip.chunks_exact(MR).zip(b_strip.chunks_exact(nr))`, so LLVM can drop bounds checks.
- Load the 3 B vectors once per `k`.
- For each of the 8 rows, splat `a[r]` and issue 3 `mul_add`s into `acc[r][v]`.

### Write-back

Full and partial blocks use one path. Each accumulator row is stored to a stack buffer `[T; NR_VECS * 8]` (8 is the most lanes of any type; enforced by a const assertion). Its valid prefix is then added into C.

The cost is `MR × NR_VECS` stores per block, against `kc × 24` FMAs, so it's negligible at KC ≥ 64.

### Parallel variant

- The `pc` loop stays serial.
- `pack_b` runs once per `pc`, and the panel is shared read-only by all tasks.
- The strips run under `par_chunks_mut(MR * n).for_each_init(Vec::new, …)`, so each worker reuses one A buffer.
- There are n/8 tasks: 512 at n=4096, 8 at n=64.
- Mark with `ponytail:` comments that `pack_b` is serial (~5% at n=4096 by estimate). Parallelize it if a profile shows it.

### Numerics

- FMA rounds once instead of twice.
- The partial sums of each `pc` block are added into C once, which is blocked summation.
- Both lower error relative to `ikj`, so the existing tolerances (8ε in unit tests, 4√N·ε at run time) keep their headroom.
- f16 accumulates in f16, as every other kernel does.

## Integration

- **`kernel.rs`:**
  - `KernelChoice::Packed` → `KernelInfo { blocks: true, ..serial("packed") }`
  - `KernelChoice::RayonPacked` → `KernelInfo { workers: true, blocks: true, ..serial("rayon-packed") }`
- **`benchmark.rs`:**
  - `Packed => sample(&PackedGemm::new(block()), …)`
  - `RayonPacked => sample(&InPool::new(threads, RayonPackedGemm::new(block()))?, …)`
- **`README.md`:** add kernel table rows, and add both kernels to the `--kernel` list and the `--block-size` "tiled kernels" list.
- **`web/src/docs/kernels/serial.md`:** add "## `packed`". **`web/src/docs/kernels/parallel.md`:** add "## `rayon-packed`". Follow the existing sections: what it does, a sketch, **Runs via**, **Tunes**, **Precisions**, **Watch for**, **Source**.

## Testing

Write the tests first, and see them fail.

1. **`every_kernel_matches_naive`** (n=7, all five precisions): add `PackedGemm::new(3)` and `RayonPackedGemm::new(3)`. `k` splits 3+3+1, and the single row block is partial (7 < 8).
2. **New test at n=37, KC=16**, for both kernels and all five precisions. `rayon-packed` runs in a 3-thread pool so strips run concurrently. The splits exercise full and partial blocks together:
   - rows: 37 = 4×8 + 5
   - columns: 37 = 3×12 + 1 (f32/i32), 24 + 13 (f16), 6×6 + 1 (f64/i64)
   - `k`: 37 = 2×16 + 5
3. The harness's run-time check (4√N·ε against `ikj`) covers every benchmark run.

## Acceptance

Throwaway runs write to the session scratchpad, never to `data/runs`.

| Check | Pass |
|---|---|
| Disassembly of the `packed` f32 micro-kernel loop | 24× `fmla.4s`. No `sp`-relative loads or stores inside the loop. |
| `packed` f32, 1 thread, n ∈ {512, 1024, 2048}, KC ∈ {64, 128, 256} | best ≥ 60 GOPS. If below 50, diagnose from the assembly before tuning. |
| `rayon-packed` f32, 8 threads, same sizes | best 2n³ / `min_ms` ≥ 400 GOPS. 8-thread medians are noisy on this machine. |
| `just check && just test` | clean |
| `cargo clippy --target aarch64-unknown-linux-gnu --all-targets -- -D warnings` | clean (the non-macOS shape) |

## Risks

- **x86 Linux CI and f16 `Simd::mul_add`.** This is only built on CI. If it fails to compile or link there, use `a*b + c` for f16 only, and record the reason.
- **LLVM spills the accumulator array.** The assembly check catches this. Fixes are, in order: confirm the micro-kernel inlines, then drop NR_VECS to 2 (16 accumulators).
- **Nightly `portable_simd` API drift.** Mitigated by the existing `rust-toolchain.toml` pin.

## Follow-ups

- **Dashboard palette:** do a validated search for a 10th host slot. `packed` takes the free red slot, which `palette.test.ts` already expects for a `packed-simd` kernel, and `rayon-packed` takes the new one. This must land before a `packed` run CSV is committed.
- **MC blocking,** if large-n results show L2 misses.
- **Parallel `pack_b`,** if a profile shows it.

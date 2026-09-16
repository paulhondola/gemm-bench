# Integer Precisions and Kernel Support Table

- **Status:** Implemented (branch `feat/integer-precisions`)
- **Roadmap item:** independent; lands before items 2, 3 and 5 so they extend the support table instead of adding per-kernel validators
- **Depends on:** item 1 (verification becomes exact for integers)

## Problem

Every benchmark is floating-point (`f16`, `f32`, `f64`). Integer GEMM is a useful contrast on Apple Silicon: `i32` vectorizes with the same four NEON lanes as `f32`, while `i64` has no NEON vector multiply and shows scalar codegen.

The CPU kernels need no change: `Element` only requires `Copy + Default + Add + Mul + AddAssign`, which integers satisfy. The float assumptions live around the kernels:

1. **Input generation.** `T::from_f64(((r*17+c*13)%23) as f64 / 23.0)` yields values in `[0, 1)`, which truncate to **0** for integers. Both inputs would be all zeros and every kernel would pass verification while measuring nothing.
2. **Precision plumbing.** `Precision`, the `run()` dispatch, `validate_mps_precision` and the default kernel list hard-code the three float types.
3. **Validator sprawl.** Items 2, 3 and 5 each propose a `validate_<kernel>_precision` function and another default-list filter. With five element types that becomes a scattered support matrix.

## Precision Support Matrix

| Kernel | f16 | f32 | f64 | i32 | i64 | Reason |
|---|---|---|---|---|---|---|
| naive, ikj, tiled, rayon-\*, static-\* | ✓ | ✓ | ✓ | ✓ | ✓ | Generic over `Element` |
| mps | ✓ | ✓ | ✗ | ✗ | ✗ | `MPSMatrixMultiplication` is float-only; Apple GPUs have no double |
| accelerate (item 2) | ✗ | ✓ | ✓ | ✗ | ✗ | BLAS has `sgemm`/`dgemm` only |
| metal-naive/tiled (item 3) | ✓ | ✓ | ✗ | ✓ (`int`) | ? | One more MSL template instantiation; MSL 64-bit integer support unverified |
| packed (item 5) | ✗ | ✓ | ✓ | ✓ | ✓ | `std::simd` covers integers, not f16; `i64` multiply scalarizes on NEON |

Items 2, 3 and 5 own their rows; this item implements the first two.

## Goals

- `--precision i32,i64` for every CPU kernel, with the same timing, statistics and verification.
- One `KernelChoice::supports(Precision) -> bool` table that drives both plan validation and the default kernel list.

## Non-Goals

- **`i8` / `i16`.** Outputs reach `616·n` (max inputs 22 × 28, summed n times): `i16` overflows at n = 54, `i8` immediately. Release builds wrap silently, which would benchmark modular arithmetic rather than a product.
- **Unsigned types.** Same codegen as signed for add/multiply; no new information.
- **Widening quantized GEMM** (`i8 × i8 → i32`). Needs distinct input/output types, which `GemmKernel<T>` does not model.
- **Renaming `gflops`.** The column keeps its name; the README documents it as operations per second for integers. Revisit alongside item 4's schema change.
- **Integer MPS.** Not supported by the framework.

## Design

### Element trait (`benchmark/src/kernels/mod.rs`)

- Replace `from_f64(value)` with `from_ratio(numerator: usize, denominator: usize) -> Self`.
  - Floats: `numerator as f64 / denominator as f64`, cast to the type. Float inputs stay bit-identical to previous runs.
  - Integers: `numerator` alone, so inputs are nonzero small integers in `0..denominator`.
- A second `impl_element!` arm for `i32`, `i64` with `EPSILON = 0.0`. The existing tolerance `4·√n·ε` becomes `0`, so verification is an exact comparison.
  - Integer addition and multiplication are associative and commutative, so every kernel must match `ikj` exactly regardless of summation order.
  - `to_f64` is exact for these outputs: the largest value, `616·n`, stays below 2⁵³ for any matrix that fits in memory.
- Module and trait docs drop "floating-point".

### MPS dispatch

- `MpsBench` stubs for unsupported types come from one macro over `f64, i32, i64`, each panicking as today. Plan validation makes them unreachable.

### Support table (`benchmark/src/cli.rs`)

```rust
impl KernelChoice {
    pub(crate) fn supports(self, precision: Precision) -> bool
}
```

- `Mps` supports `F16 | F32`; every other kernel supports all precisions.
- `validate_mps_precision` is replaced by `validate_precisions(kernels, precisions)`, which reports the first unsupported pair: `"<kernel> does not support <precision> precision"`. It runs before output files are opened, as before.
- The default kernel list is every kernel filtered by `precisions.iter().all(|&p| kernel.supports(p))`. That reproduces today's "omit mps when f64 is requested" and extends it to integers.
- Future kernels (items 2, 3, 5) add a `match` arm instead of a validator.

### Precision plumbing

- `Precision::I32` / `I64`, labels `i32` / `i64`.
- `benchmark::run` gains the two monomorphized arms.

## Error Handling

- Unsupported kernel/precision pairs fail at plan time, before any file is created.
- A kernel that differs from `ikj` by any amount on an integer run aborts the sweep (item-1 behaviour with zero tolerance).

## Testing

- Conformance: `every_kernel_matches_naive` runs for `i32` and `i64` (exact match, since `8·ε = 0`).
- Inputs: `benchmark_inputs::<i32>` produces a nonzero matrix (guards the truncation trap).
- Verification: `tolerance::<i32>(n) == 0`.
- CLI:
  - `--precision i32,i64` parses.
  - `mps` + `i32` is rejected before files are created.
  - The default kernel list omits `mps` when an integer precision is requested.
  - The existing `mps` + `f64` rejection test uses the new message.
- Real run: `just bench --sizes 256,1024 --kernel ikj,rayon-ikj --precision f32,i32,f64,i64 --repetitions 3 --output …`. Expect verification to pass, `i32` near `f32`, and `i64` well below `f64`.

## Implementation Plan

1. Branch `feat/integer-precisions`; commit this spec.
2. `kernels/mod.rs`: `from_ratio`, integer `impl_element!` arm, MPS stub macro, docs; conformance test for `i32`/`i64`. → `just test`
3. `benchmark.rs`: `benchmark_inputs` via `from_ratio`, `run()` arms, input and tolerance tests. → `just test`
4. `cli.rs`: `Precision` variants, `supports`, `validate_precisions`, default list filter, CLI tests. → `just test`, `just lint`
5. README: precision lists, support note, `gflops` wording, exact verification for integers.
6. Real run (above); push and open the PR.

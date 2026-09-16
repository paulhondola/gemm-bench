# Accelerate BLAS Kernel (AMX)

- **Status:** Proposed
- **Roadmap item:** 2 of 5
- **Depends on:** item 1 (output verification catches a wrong layout, e.g. column-major confusion)

## Problem

The suite has hand-written CPU kernels and a vendor GPU kernel (MPS), but no **vendor CPU** reference. On Apple Silicon, Level-3 BLAS in Accelerate runs on the AMX matrix coprocessor. That's the only supported way to use AMX, and the README previously misattributed AMX to MPS. Without this kernel there's no way to tell how far `rayon-ikj` (best case: 188 GFLOPS f32 at n=1024) is from what the CPU side of the chip can actually do.

## Goals

- A new kernel choice `accelerate` (label `accelerate`) on macOS that calls `cblas_sgemm` (f32) and `cblas_dgemm` (f64).
- It goes through the same timing, statistics, and verification as every other kernel.

## Non-Goals

- **f16.** BLAS has no half-precision GEMM. Reject it at plan time.
- **Thread sweeps.** AMX is a shared coprocessor and Accelerate manages its own threading, so record `threads = 1`.
- **Programming AMX instructions directly** (reverse-engineered opcodes). It's undocumented and can break with any macOS update. Rejected in review.
- **Other Accelerate APIs** (`vDSP_mmul`, BNNS). They lead to the same code path and add nothing.
- Portable BLAS backends (OpenBLAS etc.).

## Design

### FFI (`benchmark/src/kernels/accelerate.rs`, `#[cfg(target_os = "macos")]`)

- Bind the framework with `#[link(name = "Accelerate", kind = "framework")]` in an `unsafe extern "C"` block, declaring `cblas_sgemm` and `cblas_dgemm`.
- Signature: `(order, transa, transb: c_int, m, n, k: c_int, alpha, a: *const T, lda: c_int, b: *const T, ldb: c_int, beta, c: *mut T, ldc: c_int)`.
- Constants: `CBLAS_ROW_MAJOR = 101`, `CBLAS_NO_TRANS = 111`. Storage is already row-major, so no transpose trick is needed and `lda = ldb = ldc = n`.
- No new crate. The declarations and one `unsafe` call per precision stay inside this module.
- Uses the classic CBLAS symbols. The macOS 13.3+ `$NEWLAPACK` interface is left out unless the classic symbols turn out to be missing or slow; that gets decided during implementation.

### Dispatch over element type

`measure<T: Element>` is generic, so the kernel needs per-type dispatch. Follow the existing `MpsBench` pattern (`kernels/mod.rs`):

- Add a trait `AccelerateElement: Element` with `unsafe fn gemm(n: i32, a: *const Self, b: *const Self, c: *mut Self)`, implemented for `f32` (sgemm) and `f64` (dgemm).
- `AccelerateGemm` implements `GemmKernel<T>` for `T: AccelerateElement`.
- **Open decision:** `measure` still needs to reach the kernel for any `T`. Two options:
  - **(a)** Add a supertrait method on `Element` like `MpsBench` does (`AccelerateBench::run_accelerate`, with the `f16` impl being unreachable). This is consistent with existing code.
  - **(b)** Merge `MpsBench` and the new hook into one `AppleBench` trait. Less trait sprawl, but it touches MPS code.
  - **Recommendation: (a)** now, and revisit when item 3 adds a third Apple backend.
- Integer conversion: `i32::try_from(n)` with `expect`. n ≤ 46340 is already implied by memory limits.

### CLI (`benchmark/src/cli.rs`)

- `KernelChoice::Accelerate` (`#[cfg(target_os = "macos")]`), label `accelerate`, `uses_workers() == false`.
- Default kernel list: include it on macOS unless `f16` is among the precisions. This mirrors how MPS is dropped when f64 is present.
- Validation: `validate_accelerate_precision` rejects `f16` with the message "Accelerate BLAS has no f16 GEMM; use f32 or f64". It runs before any output file is opened, like `validate_mps_precision`.

### Timing (`benchmark/src/benchmark.rs`)

Use a new `measure` arm with the standard pattern: one untimed warm-up `compute`, then `repetitions` × `time_kernel`. Accelerate is synchronous, so wall-clock timing is correct.

### README

- Add a row to the CPU kernel table. Note that it runs on AMX via Accelerate, supports f32/f64, and is single-configuration.
- Add `accelerate` to the `--kernel` list and a precision note.

## Error Handling

- f16 is rejected at plan time.
- A wrong result (e.g. a mistaken order constant) is caught by item-1 verification. With identical inputs the result should be very close to ikj (different summation order, so not bit-identical).

## Testing

- Add `AccelerateGemm` to the `every_kernel_matches_naive` conformance test for f32 and f64, behind `#[cfg(target_os = "macos")]`.
- CLI tests:
  - `accelerate` parses.
  - `accelerate` + `f16` is rejected before files are created.
  - The default kernel list includes it only when f16 is absent.
- Real run: `just bench --sizes 256,1024,2048 --kernel ikj,rayon-ikj,accelerate,mps --precision f32 --output …`. Expect accelerate to beat `rayon-ikj`, and verification to pass.

## Risks

- **Threading policy is opaque.** Accelerate may spread work over P-cores in addition to AMX, so "threads = 1" means one caller thread, not one core. Say so in the README. `VECLIB_MAXIMUM_THREADS` can pin it for experiments, but the harness does not set it.
- **Classic CBLAS deprecation warnings** on newer SDKs. These are link-time symbols only, with no header warnings in Rust.

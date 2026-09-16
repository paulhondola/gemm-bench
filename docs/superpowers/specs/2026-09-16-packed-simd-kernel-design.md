# Packed Micro-Kernel GEMM with `std::simd`

- **Status:** Proposed (stretch)
- **Roadmap item:** 5 of 5
- **Depends on:** item 1 (verification). Item 4's block-size sweep should run first: if some block size already beats ikj, this item's motivation weakens.

## Problem

`tiled` loses to `ikj` everywhere (f32 single-thread: ~16–20 vs ~23–26 GFLOPS). Cache blocking alone doesn't pay on the M1: `ikj`'s long row loops already vectorize well and prefetch cleanly, and rows fit in the large L1. Production BLAS libraries get their speed from **packing** (copying blocks into contiguous buffers ordered for the micro-kernel) plus a **fixed-size SIMD micro-kernel** that updates an MR×NR block of C with values held in register lanes. This item implements that design (GotoBLAS/BLIS five-loop structure) in safe-as-possible Rust. It answers the question the tiled kernel raised, and shows how much of the gap to Accelerate (item 2) portable Rust can close.

## Goals

- A new kernel `packed` (serial) for f32 and f64, using nightly `std::simd` (`#![feature(portable_simd)]`, already on nightly for `f16`).
- Beat `ikj` single-threaded at n ≥ 512 on f32 and f64.

## Non-Goals

- **f16.** `std::simd` implements `SimdElement` for f32/f64 only, not f16 (re-check on the pinned nightly). Reject `packed` + `f16` at plan time.
- **Parallel variant.** A `rayon-packed` that parallelizes the IC loop is a natural follow-up, but out of scope here.
- **`std::arch::aarch64` intrinsics or assembly.** Portable SIMD is the point of the exercise.
- **Automatic tuning.** Use constants plus an optional CLI override; no autotuner.
- Strassen or any other recursive scheme.

## Design

### Structure (`benchmark/src/kernels/serial/packed.rs`)

Row-major C = A·B has the same structure as the column-major loops with the operands transposed. The notation below is written directly in row-major terms, with MR rows and NR columns in the micro-kernel.

```
for jc in (0..n).step_by(NC)            // columns of C / B
  for pc in (0..n).step_by(KC)          // inner dimension k
    pack B[pc..pc+KC, jc..jc+NC] into NR-wide column slivers   (fits L2)
    for ic in (0..n).step_by(MC)        // rows of C / A
      pack A[ic..ic+MC, pc..pc+KC] into MR-tall row slivers    (fits L1/L2)
      for jr in (0..nc).step_by(NR)
        for ir in (0..mc).step_by(MR)
          micro_kernel(MR×NR update of C, fringe handled below)
```

- **Packing buffers:** two `Vec<T>` allocated once per `compute` call. They count in the timed region, as they do in real BLAS.
- **Micro-kernel:**
  - Accumulates into `MR` × `Simd<T, LANES>` registers, then writes back to C.
  - Uses `mul_add` only if it measures faster; otherwise plain `a * b + c`, so results stay reproducible against ikj within the item-1 tolerance.
- **Fringes:** when the remaining rows or columns are fewer than MR/NR, run the micro-kernel into a stack scratch MR×NR buffer and copy the valid part out. That keeps a single micro-kernel with no scalar tail variants.

### Parameters

- Starting point from the BLIS `armv8a` configuration (128-bit NEON):
  - **f32:** MR=8, NR=12, LANES=4.
  - **f64:** MR=6, NR=8, LANES=2.
- Constants per element type, via an associated const on a small `PackedElement` trait implemented for f32/f64.
- **Cache blocks:** KC, MC, NC start from BLIS armv8a defaults and are tuned once on the M1 Pro. Record the chosen values and their measured justification in a comment next to the constants.
- **No new CLI flags by default.** If tuning needs repeated sweeps, reuse `--block-size` from item 4 as KC only. **Open decision** at implementation time.

### Integration

- `KernelChoice::Packed` (label `packed`), not worker-based.
- `validate_packed_precision` rejects f16.
- Add a `measure` arm with the standard pattern.
- README: add a kernel table row explaining packing + micro-kernel.

## Testing

- **Conformance:** add `PackedGemm` to `every_kernel_matches_naive` for f32 and f64 at n=7 (all fringe). Also add a test over sizes that exercise each fringe combination: n ∈ {MR−1, MR, MR+1, NR+1, KC+3} for both precisions.
- **Micro-kernel unit test:** a known MR×NR input against a scalar reference.
- **Verification:** item 1 runs automatically in real sweeps.
- **Performance acceptance:** `--kernel ikj,tiled,packed,accelerate --sizes 512,1024,2048,4096 --precision f32,f64 --repetitions 5`. Target: `packed` > `ikj` at n ≥ 512. Report the ratio to `accelerate` without a target.

## Risks

- **Nightly `portable_simd` API drift.** Pin via the existing `rust-toolchain.toml`.
- **Autovectorization** may already make a scalar micro-kernel as fast as the SIMD one. Measure both once and keep the simpler if equal.
- **Complexity:** this is the largest item on the roadmap. If the fringe handling or packing indexing grows beyond one file of roughly 250 lines, stop and re-scope.

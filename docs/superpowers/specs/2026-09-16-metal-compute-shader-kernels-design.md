# Custom Metal Compute Shader Kernels

- **Status:** Proposed
- **Roadmap item:** 3 of 5
- **Depends on:** item 1 (verification and statistics). Independent of item 2.

## Problem

The GPU side currently has one data point, MPS. It's a vendor library and a black box: at n=2048 it reaches 3.6k GFLOPS against 149 for `rayon-ikj`, but the suite can't show *why*. The CPU side tells the naive → ikj → tiled story; the GPU side has no matching progression. Two hand-written shaders give that progression: **naive → tiled (threadgroup memory) → MPS**.

A second problem needs fixing first. `benchmark/src/kernels/mps.rs` contains the full Metal setup twice (`compute` and `benchmark` each create buffers, copy data in, build descriptors and matrices). Adding two more Metal kernels on top of that would mean four copies.

## Goals

1. Extract the shared Metal setup into one module; MPS keeps its behaviour and its numbers.
2. Add kernel choices `metal-naive` and `metal-tiled` (f16, f32) using the same timing and verification as the other kernels.
3. Time both GPU-only and end-to-end (host copies + encoding) for all Metal kernels, including MPS.

## Non-Goals

- **f64.** Apple GPUs have no double type.
- **An ahead-of-time `.metallib` build** (`build.rs`, `xcrun metal`). Compile from source at runtime instead.
- **MPSGraph, wgpu/Vulkan, Core ML/ANE.** Rejected in review.
- **Zero-copy `newBufferWithBytesNoCopy` over `Matrix` storage.** Needs page-aligned allocation in `Matrix`; a possible follow-up once end-to-end timing shows the copy cost matters.
- Batched small-matrix dispatch.

## Design

### Shared Metal context (`benchmark/src/kernels/metal/mod.rs`)

- Move `mps.rs` to `kernels/metal/mps.rs`. Add `kernels/metal/context.rs` and `kernels/metal/shaders.rs`.
- `MetalContext { device, queue }`, created once per kernel instance.
- `GpuOperands<T>`: three `StorageModeShared` buffers plus `upload(lhs, rhs)` and `download(output)`, so the unsafe `copy_nonoverlapping` code lives in one place.
- A trait `GpuDispatch` with `fn encode(&self, cmd_buf, operands)`, implemented by MPS and both shaders.
- A single `benchmark(dispatch, operands, repetitions) -> Timings` runs the warm-up, then the timed `commit` → `waitUntilCompleted` loop.
- `GemmKernel::compute` for each Metal kernel uses the same helper with one repetition, so the setup code exists once.
- `MpsElement` becomes `MetalElement`, which carries both `mps_data_type()` and `const MSL_TYPE: &str` (`"half"` / `"float"`).

### Shaders (`benchmark/src/kernels/metal/gemm.metal`, embedded with `include_str!`)

- Compiled once per kernel instance with `newLibraryWithSource:options:error:`, then `newComputePipelineStateWithFunction:error:`. Compile errors come back as `Err`, with the compiler log in the message.
- **Precision:** write the kernels as MSL templates and instantiate them explicitly, e.g. `template [[host_name("gemm_naive_float")]] kernel void gemm_naive<float>(…)`. Rust picks the function by name `format!("gemm_naive_{}", T::MSL_TYPE)`.
- Uniform `n` is passed with `setBytes` (a `uint`).
- **`gemm_naive`:**
  - One thread per output element, 2D grid n×n: `C[i*n+j] = Σ_k A[i*n+k]·B[k*n+j]`.
  - Dispatch with `dispatchThreads` and a threadgroup size from `threadExecutionWidth` × (`maxTotalThreadsPerThreadgroup` / width).
- **`gemm_tiled`:**
  - The classic tiled matmul with threadgroup memory, tile size `T = 16`.
  - For each tile: load one row tile of A and one column tile of B into `threadgroup` arrays, then sum over the tile locally.
  - Out-of-range loads write 0.
  - Dispatch with `dispatchThreadgroups` using a fixed threadgroup size T×T and `ceil(n/T)` groups, with bounds checks on write.
  - T=16 gives 256 threads per group, which stays within the M1 limit of 1024.

### Timing

- **GPU-only** (current MPS semantics): `commit` → `waitUntilCompleted`, reported under the kernel's plain label.
- **End-to-end:** upload, encode, commit, wait and download.
  - Every Metal kernel configuration emits **two records** from the same run: the plain label, and the label with an `-e2e` suffix (`mps-e2e`, `metal-naive-e2e`, `metal-tiled-e2e`). Both are measured in the same repetition loop, so the CSV schema stays unchanged and no CLI flag is needed.
  - Rejected alternative: a new `scope` column. Cleaner for the dashboard, but a second schema change on top of item 4's.
- Verification (item 1) runs on the downloaded output for every Metal kernel.

### CLI

- New `KernelChoice` variants `MetalNaive` and `MetalTiled` (macOS-only). No flag for end-to-end timing; the runner always emits both records (see Timing).
- `measure` returns two sample vectors for Metal kernels, and `total_configurations` counts Metal kernels twice so the progress bar stays exact.
- The f64 rejection generalizes to `validate_gpu_precision`, covering every Metal-backed kernel.
- Default kernel list: add both shaders on macOS when f64 is absent. This is the same rule MPS already follows.

## Error Handling

- Shader compile or pipeline failures return `Err` when the kernel is constructed, before timing, with the MSL compiler log in the message.
- Command buffer errors: after `waitUntilCompleted`, check `cmd_buf.status() == Error` and return `Err` with `cmd_buf.error()`. **This check is missing in MPS today.**
- **Risk, GPU watchdog:** naive at n=4096 may run for seconds in one command buffer, and macOS can kill long-running command buffers while the GPU is also driving a display. If it happens, report it as an error; do not split the dispatch into bands (that adds complexity for one edge case). Document a size ceiling if needed.

## Testing

- Add Metal kernels to the conformance test at n=7 and at a non-multiple of T (n=37), f16 and f32, macOS-only.
  - Use the item-1 `4·√n·ε` tolerance: MSL enables fast-math by default, so summation order and contraction differ from the CPU kernels.
- Refactor guard: MPS results before and after the context extraction must pass verification, and GFLOPS stays within run-to-run noise at n=1024 and n=2048.
- CLI tests: new kernels parse; f64 is rejected; defaults behave as described.
- Real run: `--sizes 256,1024,2048 --kernel mps,metal-naive,metal-tiled --precision f16,f32`. Expect the order naive < tiled < MPS.

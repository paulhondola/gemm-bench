# Custom Metal Compute Shader Kernels

- **Status:** Approved (revised 2026-09-25 against `main` at 59a3eff)
- **Roadmap item:** 3 of 5
- **Depends on:** item 1 (verification and statistics) and the integer-precisions support table, both landed.

## Problem

The GPU side currently has one data point, MPS. It's a vendor library and a black box: at n=2048 it reaches 3.6k GFLOPS against 149 for `rayon-ikj`, but the suite can't show *why*. The CPU side tells the naive → ikj → tiled story; the GPU side has no matching progression. Two hand-written shaders give that progression: **naive → tiled (threadgroup memory) → MPS**.

MPS also covers only `f16`/`f32`. Hand-written shaders can run the integer precisions MPS lacks.

## Goals

1. Move the Metal setup out of `mps.rs` into a shared module that three kernels use; MPS keeps its behaviour and its numbers.
2. Add kernel choices `metal-naive` and `metal-tiled` at `f16`, `f32`, `i32`, `i64`, with the same timing and verification as the other kernels.
3. Time both GPU-only and end-to-end (host copies + encoding) for all Metal kernels, including MPS.

## Non-Goals

- **`f64`.** Apple GPUs have no double type; the MSL compiler rejects `double` (probed on M1 Pro).
- **`bf16`.** MSL `bfloat` compiles on M1 Pro, but Rust has no stable `bf16` and `Precision` has no variant.
- **An ahead-of-time `.metallib` build** (`build.rs`, `xcrun metal`). Measured on M1 Pro: runtime compile of the full shader source is ~81 ms once per process, then ~17 ms per kernel, all untimed. Building ahead of time would save that at the cost of a build dependency (the Metal Toolchain, an optional Xcode component), ~25 lines of `build.rs`, a direct `dispatch2` dependency and a third deployment-target setting to keep in sync. Compile errors surface in the conformance tests instead of at `cargo build`.
- **MPSGraph, wgpu/Vulkan, Core ML/ANE.** Rejected in review.
- **Zero-copy `newBufferWithBytesNoCopy` over `Matrix` storage.** Needs page-aligned allocation in `Matrix`; a possible follow-up once end-to-end timing shows the copy cost matters.
- **A tile-size sweep.** `metal-tiled` uses a fixed tile and does not read `--block-size`.
- **Dashboard colours.** The palette's nine validated slots are all claimed, and its rules forbid adding hues by eye. The five new labels (`metal-naive`, `metal-tiled`, `mps-e2e`, `metal-naive-e2e`, `metal-tiled-e2e`) render without a slot in per-kernel views until a dashboard follow-up decides how GPU kernels fold. The GPU-vs-CPU chart keys on `backend = "metal"` and needs no change.
- Batched small-matrix dispatch.

## Design

### Module layout (`benchmark/src/kernels/metal/`)

| File | Contents |
|---|---|
| `mod.rs` | `default_device_name()` (moved from `mps.rs`), `GpuOperands<T>`, `GpuDispatch`, `time_dispatch(…)` timing loop, `GpuSamples` |
| `mps.rs` | `MpsGemm<T>`: the MPS descriptors and `MPSMatrixMultiplication`, implementing `GpuDispatch` |
| `shader.rs` | `ShaderGemm<T>` and `Shader::{Naive, Tiled}`: library compile, pipeline, encoding, implementing `GpuDispatch` |
| `gemm.metal` | The two MSL kernel templates and their explicit instantiations, embedded with `include_str!` |

`kernels/mod.rs` re-exports `MpsGemm`, `ShaderGemm` and `Shader`. `plan.rs` calls `kernels::metal::default_device_name`.

### Shared pieces (`metal/mod.rs`)

- `GpuOperands<T>`: three `StorageModeShared` buffers of `n·n` elements, with `upload(lhs, rhs)` and `download(output)`. The unsafe `copy_nonoverlapping` code lives only here.
- `trait GpuDispatch { fn encode(&self, cmd_buf, operands, n) }`: implemented by `MpsGemm` and `ShaderGemm`. Each kernel owns its device and command queue, created once per kernel instance.
- `time_dispatch(dispatch, lhs, rhs, output, repetitions) -> Result<GpuSamples, String>`, where `GpuSamples { gpu: Vec<Duration>, e2e: Vec<Duration> }`:
  1. Allocate the operands once.
  2. One untimed warm-up iteration, the same steps as below including `download`, so `output` holds a result even with zero repetitions.
  3. For each repetition: start e2e clock → `upload` → new command buffer → `encode` → start GPU clock → `commit` → `waitUntilCompleted` → stop GPU clock → check `cmd_buf.status()` → `download` → stop e2e clock.
  4. After every `waitUntilCompleted`, a status of `Error` returns `Err` with `cmd_buf.error()`. **This check is missing in MPS today.**
- `GemmKernel::compute` for each Metal kernel calls `time_dispatch` with zero repetitions and `expect`s the result, so setup code exists once.

### Element mapping

Keyed on `TypeId`, returning `Option`, the same way `mps_data_type::<T>()` works today. A trait bound would not work: `measure<T: Element>` is generic over every precision, `f64` included.

| Rust | `msl_type::<T>()` | `mps_data_type::<T>()` |
|---|---|---|
| `f16` | `"half"` | `Float16` |
| `f32` | `"float"` | `Float32` |
| `i32` | `"int"` | `None` |
| `i64` | `"long"` | `None` |
| `f64` | `None` | `None` |

`ShaderGemm::<T>::new(shader)` returns `Ok(None)` when `msl_type::<T>()` is `None` (like `MpsGemm::new`), and `Err` when library or pipeline creation fails.

### Shaders (`gemm.metal`)

- Compiled once per kernel instance with `newLibraryWithSource:options:error:` (default options, so fast-math on), then `newComputePipelineStateWithFunction:error:`. Failures return `Err` with the compiler log.
- Each kernel is an MSL template, instantiated explicitly per type:
  `template [[host_name("gemm_naive_float")]] kernel void gemm_naive<float>(…);`
  Rust looks the function up as `format!("gemm_{}_{}", shader.name(), msl_type)`.
- Buffers 0/1/2 are A, B, C. `n` is passed with `setBytes` as a `uint` at index 3.
- The accumulator is `T`: `half` sums in `half` and `long` sums in `long`, the same as the CPU kernels.
- **`gemm_naive`:**
  - One thread per output element, 2D grid n×n. **`gid.x` is the column `j`, `gid.y` the row `i`**, so neighbouring threads read contiguous `B[k·n + j]` and share `A[i·n + k]`.
  - `C[i·n + j] = Σ_k A[i·n + k] · B[k·n + j]`, with an early return for `gid` outside n×n.
  - Dispatch with `dispatchThreads(n×n)`. Threadgroup size is `threadExecutionWidth` × (`maxTotalThreadsPerThreadgroup` / width), which is 32×32 on M1 Pro.
- **`gemm_tiled`:**
  - Classic threadgroup-memory tiling with `TS = 16`: two `threadgroup T[16][16]` tiles, which is 4 KB at `long` and well inside the 32 KB limit.
  - For each tile: each thread loads one element of A's row tile and one of B's column tile (0 when out of range), `threadgroup_barrier(mem_threadgroup)`, sums 16 products, and hits a second barrier before the next load.
  - Dispatch with `dispatchThreadgroups(ceil(n/16) × ceil(n/16))` at 16×16 threads, with a bounds check on the write.

### Timing

- **GPU-only** (current MPS semantics): `Instant` around `commit` → `waitUntilCompleted`, reported under the kernel's plain label. It stays on the CPU clock rather than `GPUStartTime`/`GPUEndTime` so MPS numbers remain comparable across the refactor.
- **End-to-end:** upload, encode, commit, wait and download, reported as `<label>-e2e` (`mps-e2e`, `metal-naive-e2e`, `metal-tiled-e2e`).
- Both come from the same repetitions, so the CSV schema is unchanged and there is no CLI flag. Rejected alternative: a `scope` column, cleaner for the dashboard but a schema change.
- On unified memory the upload/download is a `memcpy` into shared buffers, so `e2e − gpu` is mostly copy cost. It is the evidence for or against the zero-copy follow-up.
- Verification runs once per configuration, on the output downloaded by the last repetition. Both records carry the same `mean_rel_error_f64`.

### Harness (`benchmark.rs`)

- `measure` returns `Samples { timed: Vec<Duration>, e2e: Option<Vec<Duration>> }`: `None` for CPU/AMX kernels, `Some` for the three Metal kernels. Its error type widens to `Box<dyn Error>`, since Metal setup and dispatch can now fail with an `Err` instead of a panic.
- `run_precision` pushes the plain record, then, when `e2e` is `Some`, a second record with the `-e2e` label and stats from those samples. `BenchmarkRecord.kernel` is already a `String`.
- The progress bar counts measured configurations, one step per `measure` call. `total_configurations` is unchanged.

### CLI and kernel table (`kernel.rs`, `plan.rs`)

- New `KernelChoice` variants `MetalNaive` and `MetalTiled` (macOS-only), labels `metal-naive` and `metal-tiled`, `backend: "metal"`, `precisions: &[F16, F32, I32, I64]`, no workers, no blocks.
- Unsupported precisions (`f64`) are skipped or rejected by the existing `supports()` table, so no new validator and no default-list rule are needed.
- `Devices::lookup` and `Devices::of` test `kernel.backend() == "metal"` instead of `== KernelChoice::Mps`.

## Error Handling

- Library compile or pipeline failures: `Err` when the kernel is constructed, before timing, with the MSL compiler log.
- Command buffer errors: `Err` with `cmd_buf.error()` after any `waitUntilCompleted` whose status is `Error`, including in MPS.
- **GPU watchdog:** measured on M1 Pro, the slowest configuration (naive `long`) runs ~82 ms at n=2048, which extrapolates to ~0.7 s at n=4096. No size ceiling and no banded dispatch; the status check reports it if it ever happens.

## Testing

- **Conformance** (`kernels/mod.rs`, macOS-only): `metal-naive` and `metal-tiled` against `NaiveGemm` at n=7 and n=37 (not a multiple of 16), at `f16`, `f32`, `i32`, `i64`. The existing `assert_close` gives integers zero tolerance, so they must match exactly (probed: they do, including `long` products up to 7.5e15).
- `ShaderGemm::<f64>::new` returns `Ok(None)`.
- **Refactor guard:** MPS conformance still passes, and `bench-compare` of MPS before and after the extraction stays within run-to-run noise at n=1024 and n=2048.
- **CLI:** new kernels parse; they have no cells at `f64`; `Devices` names the GPU for them; `every_kernel_names_its_backend` covers them.
- **Real run:** `--sizes 256,1024,2048 --kernel mps,metal-naive,metal-tiled --precision f16,f32,i32,i64 --output /tmp/metal.csv`. Expect naive < tiled < MPS where MPS runs. Naive measured 310–415 GOPS (f16/f32/i32) and 210 (i64) at n=2048.

## Docs

- README: add `metal-naive` and `metal-tiled` to the Apple Silicon GPU table, note the `-e2e` records under Methodology, and extend the GPU example command.
- CLAUDE.md: no new gotcha; the existing "`mps` is macOS only" line becomes "Metal kernels are macOS only".

# Metal Compute Shader Kernels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hand-written Metal GEMM shaders `metal-naive` and `metal-tiled` (f16, f32, i32, i64) next to MPS, share one Metal timing loop across all three, and record GPU-only plus end-to-end (`-e2e`) timings for every Metal kernel.

**Architecture:** `benchmark/src/kernels/mps.rs` becomes `kernels/metal/`, which holds the shared buffers, a `GpuDispatch` trait each kernel implements to encode its work, and one `time_dispatch` loop that returns GPU-only and end-to-end samples. A templated `gemm.metal`, embedded with `include_str!` and compiled at runtime, provides both shaders for every precision via explicit instantiations named `gemm_<shader>_<msl type>`. The harness turns the end-to-end samples into a second CSV record labelled `<kernel>-e2e`.

**Tech Stack:** Rust nightly (edition 2024), `objc2` 0.6 / `objc2-metal` 0.3.2 / `objc2-foundation` 0.3.2 / `objc2-metal-performance-shaders` 0.3.2 (all already dependencies), Metal Shading Language, `just`, lefthook.

**Spec:** `docs/superpowers/specs/2026-09-16-metal-compute-shader-kernels-design.md`

## Global Constraints

- Branch: `feat/metal-shader-kernels` (already created; the spec commit is on it).
- Rust is nightly, pinned by `rust-toolchain.toml`; `f16` needs `#![feature(f16)]`, already enabled crate-wide.
- All Metal code is macOS-only: it lives under `kernels::metal` (declared `#[cfg(target_os = "macos")]`) or carries `#[cfg(target_os = "macos")]`. CI is Linux and never compiles it.
- No new crate dependencies. No `build.rs` changes. Shaders are compiled at runtime with `newLibraryWithSource:options:error:`; the Metal Toolchain is not required.
- f64 is not supported by any Metal kernel (Apple GPUs have no `double`). `mps` stays `f16`/`f32`. `metal-naive`/`metal-tiled` run `f16`, `f32`, `i32`, `i64` as MSL `half`, `float`, `int`, `long`.
- Labels are exactly `metal-naive`, `metal-tiled`, and the end-to-end records `mps-e2e`, `metal-naive-e2e`, `metal-tiled-e2e`. `backend` is `"metal"` for all of them.
- The CSV schema does not change.
- Never write into `data/runs/` during this work: pass `--output /tmp/<name>.csv` to every `just bench`.
- Don't bypass lefthook (`--no-verify`). It runs fmt, clippy (`-D warnings`) and tests on commit.
- Before the final push: `just check && just test`.
- Per `CLAUDE.md`: `serial::IkjGemm` is the correctness reference; don't touch it.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `benchmark/src/kernels/metal/mod.rs` | Create | `default_device_name`, `MetalContext`, `GpuOperands<T>`, `GpuDispatch<T>`, `GpuSamples`, `time_dispatch` |
| `benchmark/src/kernels/metal/mps.rs` | Move from `kernels/mps.rs`, rewrite | `MpsGemm<T>`: MPS objects and `GpuDispatch` impl |
| `benchmark/src/kernels/metal/shader.rs` | Create | `Shader`, `ShaderGemm<T>`, `msl_type`: compile, pipeline, encode |
| `benchmark/src/kernels/metal/gemm.metal` | Create | `gemm_naive`, `gemm_tiled` templates + 8 explicit instantiations |
| `benchmark/src/kernels/mod.rs` | Modify | Module/re-exports; Metal conformance tests |
| `benchmark/src/benchmark.rs` | Modify | `measure` returns `Samples`; `run_precision` emits `-e2e` records; new arms |
| `benchmark/src/kernel.rs` | Modify | `KernelChoice::{MetalNaive, MetalTiled}` + `KernelInfo` rows |
| `benchmark/src/plan.rs` | Modify | `Devices` keyed on `backend() == "metal"` |
| `benchmark/src/cli.rs` | Modify | CLI tests only |
| `README.md`, `CLAUDE.md` | Modify | Kernel docs, methodology, gotcha line |

---

### Task 1: Move the shared Metal code into `kernels/metal/` and put MPS on it

**Files:**
- Create: `benchmark/src/kernels/metal/mod.rs`
- Move + rewrite: `benchmark/src/kernels/mps.rs` → `benchmark/src/kernels/metal/mps.rs`
- Modify: `benchmark/src/kernels/mod.rs` (module decl, re-export, one new test)
- Modify: `benchmark/src/plan.rs` (`default_device_name` path)
- Modify: `benchmark/src/benchmark.rs` (`measure` error type, MPS arm)

**Interfaces:**
- Produces (in `gemm_bench::kernels::metal`):
  - `pub fn default_device_name() -> Option<String>`
  - `pub(crate) struct MetalContext` with `pub(crate) fn new() -> Option<Self>`; fields `device: Retained<ProtocolObject<dyn MTLDevice>>`, `queue: Retained<ProtocolObject<dyn MTLCommandQueue>>` (private, visible to child modules)
  - `pub(crate) struct GpuOperands<T>`; fields `lhs`, `rhs`, `output: Retained<ProtocolObject<dyn MTLBuffer>>`, `n: usize` (private, visible to child modules)
  - `pub(crate) trait GpuDispatch<T: Element> { fn context(&self) -> &MetalContext; fn encode(&self, cmd_buf: &ProtocolObject<dyn MTLCommandBuffer>, operands: &GpuOperands<T>) -> Result<(), String>; }`
  - `pub struct GpuSamples { pub gpu: Vec<Duration>, pub e2e: Vec<Duration> }`
  - `pub(crate) fn time_dispatch<T: Element>(kernel: &impl GpuDispatch<T>, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>, repetitions: usize) -> Result<GpuSamples, String>`
  - `MpsGemm::<T>::benchmark(&self, lhs, rhs, output, repetitions) -> Result<GpuSamples, String>` (was `-> Vec<Duration>`)
- `gemm_bench::kernels::MpsGemm` keeps its path via re-export.

- [ ] **Step 1: Record the MPS baseline before changing anything**

The refactor guard compares MPS before and after. Take the "before" run now, while the code still matches `main`:

```bash
just bench --sizes 1024,2048 --kernel mps --precision f16,f32 --repetitions 10 --no-progress --output /tmp/gemm-mps-before.csv
```

Expected: 4 rows written to `/tmp/gemm-mps-before.csv`.

- [ ] **Step 2: Write the failing test**

In `benchmark/src/kernels/mod.rs`, inside `mod tests`, after `mps_matches_naive_on_f16_and_f32`, add:

```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn mps_benchmark_times_every_repetition_both_ways() {
        let n = 16;
        let (lhs, rhs) = inputs::<f32>(n);
        let mut output = Matrix::zeros(n, n);
        let mps = super::MpsGemm::<f32>::new().expect("MPS should initialize");
        let samples = mps
            .benchmark(&lhs, &rhs, &mut output, 3)
            .expect("the dispatch should succeed");
        assert_eq!((samples.gpu.len(), samples.e2e.len()), (3, 3));
        // End-to-end wraps the GPU-only window, so it can never be shorter.
        assert!(samples.gpu.iter().zip(&samples.e2e).all(|(gpu, e2e)| gpu <= e2e));
    }
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml mps_benchmark_times`
Expected: FAIL to compile: `no field `gpu` on type `Vec<Duration>``.

- [ ] **Step 4: Create `benchmark/src/kernels/metal/mod.rs`**

```rust
//! Metal plumbing shared by the GPU kernels: unified-memory operands and one
//! timing loop that every kernel's `encode` plugs into.

pub mod mps;

use std::marker::PhantomData;
use std::time::{Duration, Instant};

use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::ProtocolObject;
use objc2_metal::{
    MTLBuffer, MTLCommandBuffer, MTLCommandBufferStatus, MTLCommandQueue,
    MTLCreateSystemDefaultDevice, MTLDevice, MTLResourceOptions,
};

pub use mps::MpsGemm;

use crate::kernels::assert_gemm_dimensions;
use crate::{Element, Matrix};

/// Name of the system default Metal device, the one every Metal kernel acquires.
pub fn default_device_name() -> Option<String> {
    MTLCreateSystemDefaultDevice().map(|device| device.name().to_string())
}

/// The system default device and a command queue on it, created once per
/// kernel instance.
pub(crate) struct MetalContext {
    device: Retained<ProtocolObject<dyn MTLDevice>>,
    queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
}

impl MetalContext {
    /// `None` without a Metal device.
    pub(crate) fn new() -> Option<Self> {
        let device = MTLCreateSystemDefaultDevice()?;
        let queue = device.newCommandQueue()?;
        Some(Self { device, queue })
    }
}

/// `lhs`, `rhs` and `output` as `n`×`n` unified-memory buffers the GPU reads
/// and writes in place.
pub(crate) struct GpuOperands<T> {
    lhs: Retained<ProtocolObject<dyn MTLBuffer>>,
    rhs: Retained<ProtocolObject<dyn MTLBuffer>>,
    output: Retained<ProtocolObject<dyn MTLBuffer>>,
    n: usize,
    _marker: PhantomData<T>,
}

impl<T: Element> GpuOperands<T> {
    fn new(device: &ProtocolObject<dyn MTLDevice>, n: usize) -> Result<Self, String> {
        let bytes = n * n * size_of::<T>();
        let buffer = || {
            device
                .newBufferWithLength_options(bytes, MTLResourceOptions::StorageModeShared)
                .ok_or_else(|| format!("failed to allocate a {bytes}-byte Metal buffer"))
        };
        Ok(Self {
            lhs: buffer()?,
            rhs: buffer()?,
            output: buffer()?,
            n,
            _marker: PhantomData,
        })
    }

    fn upload(&self, lhs: &Matrix<T>, rhs: &Matrix<T>) {
        let count = self.n * self.n;
        // SAFETY: each buffer holds `n * n` elements of `T` (see `new`), the
        // matrices hold as many (`time_dispatch` asserts their shape), and
        // shared-storage buffers are CPU-addressable.
        unsafe {
            std::ptr::copy_nonoverlapping(
                lhs.as_slice().as_ptr(),
                self.lhs.contents().as_ptr().cast(),
                count,
            );
            std::ptr::copy_nonoverlapping(
                rhs.as_slice().as_ptr(),
                self.rhs.contents().as_ptr().cast(),
                count,
            );
        }
    }

    fn download(&self, output: &mut Matrix<T>) {
        // SAFETY: as in `upload`; no command buffer is in flight when this runs.
        unsafe {
            std::ptr::copy_nonoverlapping(
                self.output.contents().as_ptr().cast(),
                output.as_mut_slice().as_mut_ptr(),
                self.n * self.n,
            );
        }
    }
}

/// A GPU kernel the shared timing loop can drive.
pub(crate) trait GpuDispatch<T: Element> {
    fn context(&self) -> &MetalContext;

    /// Records one `output = lhs * rhs` into `cmd_buf`, without committing it.
    fn encode(
        &self,
        cmd_buf: &ProtocolObject<dyn MTLCommandBuffer>,
        operands: &GpuOperands<T>,
    ) -> Result<(), String>;
}

/// Per-repetition timings of a Metal kernel.
pub struct GpuSamples {
    /// `commit` → `waitUntilCompleted`: GPU execution only.
    pub gpu: Vec<Duration>,
    /// Upload, encode, commit, wait and download: what a caller pays.
    pub e2e: Vec<Duration>,
}

/// Runs one untimed warm-up iteration, then `repetitions` timed ones, and
/// leaves the last result in `output`. Every iteration does the full
/// upload → encode → commit → wait → download round trip; the GPU-only window
/// sits inside the end-to-end one.
pub(crate) fn time_dispatch<T: Element>(
    kernel: &impl GpuDispatch<T>,
    lhs: &Matrix<T>,
    rhs: &Matrix<T>,
    output: &mut Matrix<T>,
    repetitions: usize,
) -> Result<GpuSamples, String> {
    assert_gemm_dimensions(lhs, rhs, output);
    autoreleasepool(|_| {
        let context = kernel.context();
        let operands = GpuOperands::<T>::new(&context.device, lhs.rows())?;
        let mut samples = GpuSamples {
            gpu: Vec::with_capacity(repetitions),
            e2e: Vec::with_capacity(repetitions),
        };
        // Iteration 0 is the warm-up: it brings the GPU clock up and is not recorded.
        for iteration in 0..=repetitions {
            let start = Instant::now();
            operands.upload(lhs, rhs);
            let cmd_buf = context
                .queue
                .commandBuffer()
                .ok_or("failed to create a Metal command buffer")?;
            kernel.encode(&cmd_buf, &operands)?;
            let gpu_start = Instant::now();
            cmd_buf.commit();
            cmd_buf.waitUntilCompleted();
            let gpu = gpu_start.elapsed();
            if cmd_buf.status() == MTLCommandBufferStatus::Error {
                let reason = cmd_buf.error().map_or_else(
                    || "no error detail".to_owned(),
                    |error| error.localizedDescription().to_string(),
                );
                return Err(format!("Metal command buffer failed: {reason}"));
            }
            operands.download(output);
            let e2e = start.elapsed();
            if iteration > 0 {
                samples.gpu.push(gpu);
                samples.e2e.push(e2e);
            }
        }
        Ok(samples)
    })
}
```

- [ ] **Step 5: Move and rewrite `mps.rs`**

```bash
mkdir -p benchmark/src/kernels/metal && git mv benchmark/src/kernels/mps.rs benchmark/src/kernels/metal/mps.rs
```

Replace the whole contents of `benchmark/src/kernels/metal/mps.rs` with:

```rust
//! Apple Silicon GPU GEMM kernel using `MetalPerformanceShaders` (`MPSMatrixMultiplication`).

use std::any::TypeId;
use std::marker::PhantomData;

use objc2::AnyThread;
use objc2::runtime::ProtocolObject;
use objc2_metal::{MTLBuffer, MTLCommandBuffer};
use objc2_metal_performance_shaders::{
    MPSDataType, MPSMatrix, MPSMatrixDescriptor, MPSMatrixMultiplication,
};

use super::{GpuDispatch, GpuOperands, GpuSamples, MetalContext, time_dispatch};
use crate::kernels::GemmKernel;
use crate::{Element, Matrix};

/// The MPS data type for `T`: Metal Performance Shaders multiplies half
/// (`f16`) and single (`f32`) precision only; Apple Silicon GPUs have no `f64`.
fn mps_data_type<T: 'static>() -> Option<MPSDataType> {
    if TypeId::of::<T>() == TypeId::of::<f16>() {
        Some(MPSDataType::Float16)
    } else if TypeId::of::<T>() == TypeId::of::<f32>() {
        Some(MPSDataType::Float32)
    } else {
        None
    }
}

/// A dense matrix multiplication kernel leveraging Apple's `MPSMatrixMultiplication`.
pub struct MpsGemm<T: Element> {
    context: MetalContext,
    data_type: MPSDataType,
    _marker: PhantomData<T>,
}

impl<T: Element> MpsGemm<T> {
    /// Acquires the system default Metal device and a command queue. `None`
    /// without a Metal device or for a precision other than `f16`/`f32`.
    pub fn new() -> Option<Self> {
        let data_type = mps_data_type::<T>()?;
        Some(Self {
            context: MetalContext::new()?,
            data_type,
            _marker: PhantomData,
        })
    }

    /// Times `repetitions` dispatches after one untimed warm-up; see
    /// [`time_dispatch`](super::time_dispatch).
    pub fn benchmark(
        &self,
        lhs: &Matrix<T>,
        rhs: &Matrix<T>,
        output: &mut Matrix<T>,
        repetitions: usize,
    ) -> Result<GpuSamples, String> {
        time_dispatch(self, lhs, rhs, output, repetitions)
    }
}

impl<T: Element> GpuDispatch<T> for MpsGemm<T> {
    fn context(&self) -> &MetalContext {
        &self.context
    }

    fn encode(
        &self,
        cmd_buf: &ProtocolObject<dyn MTLCommandBuffer>,
        operands: &GpuOperands<T>,
    ) -> Result<(), String> {
        let n = operands.n;
        // All three operands are n×n and row-major, so one descriptor fits them all.
        let descriptor = unsafe {
            MPSMatrixDescriptor::matrixDescriptorWithRows_columns_rowBytes_dataType(
                n,
                n,
                n * size_of::<T>(),
                self.data_type,
            )
        };
        let matrix = |buffer: &ProtocolObject<dyn MTLBuffer>| unsafe {
            MPSMatrix::initWithBuffer_descriptor(MPSMatrix::alloc(), buffer, &descriptor)
        };
        let (lhs, rhs, output) = (
            matrix(&operands.lhs),
            matrix(&operands.rhs),
            matrix(&operands.output),
        );
        let multiply = unsafe {
            MPSMatrixMultiplication::initWithDevice_transposeLeft_transposeRight_resultRows_resultColumns_interiorColumns_alpha_beta(
                MPSMatrixMultiplication::alloc(),
                &self.context.device,
                false,
                false,
                n,
                n,
                n,
                1.0,
                0.0,
            )
        };
        unsafe {
            multiply.encodeToCommandBuffer_leftMatrix_rightMatrix_resultMatrix(
                cmd_buf, &lhs, &rhs, &output,
            );
        }
        Ok(())
    }
}

impl<T: Element> GemmKernel<T> for MpsGemm<T> {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        // Zero repetitions: just the untimed dispatch and the copy back.
        self.benchmark(lhs, rhs, output, 0)
            .expect("the MPS dispatch failed");
    }
}
```

- [ ] **Step 6: Point `kernels/mod.rs` at the new module**

In `benchmark/src/kernels/mod.rs`, replace:

```rust
#[cfg(target_os = "macos")]
pub mod mps;
```

with:

```rust
#[cfg(target_os = "macos")]
pub mod metal;
```

and replace:

```rust
#[cfg(target_os = "macos")]
pub use mps::MpsGemm;
```

with:

```rust
#[cfg(target_os = "macos")]
pub use metal::MpsGemm;
```

- [ ] **Step 7: Update the two callers**

In `benchmark/src/plan.rs`, `Devices::lookup`, replace `.then(gemm_bench::kernels::mps::default_device_name)` with `.then(gemm_bench::kernels::metal::default_device_name)`.

In `benchmark/src/benchmark.rs`, `measure`: change the return type from `Result<Vec<Duration>, rayon::ThreadPoolBuildError>` to `Result<Vec<Duration>, Box<dyn std::error::Error>>`, and replace the MPS arm with:

```rust
        // MPS times only the GPU dispatch, so it runs its own loop.
        #[cfg(target_os = "macos")]
        KernelChoice::Mps => {
            MpsGemm::<T>::new()
                .expect("MPS needs a Metal device and f16 or f32")
                .benchmark(lhs, rhs, io.2, repetitions)?
                .gpu
        }
```

(`?` converts both `rayon::ThreadPoolBuildError` and `String` into `Box<dyn Error>`, and `run_precision` already returns that type.)

- [ ] **Step 8: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS, including `mps_benchmark_times_every_repetition_both_ways` and `mps_matches_naive_on_f16_and_f32`.

Run: `just check-bench`
Expected: no warnings.

- [ ] **Step 9: Refactor guard**

```bash
just bench --sizes 1024,2048 --kernel mps --precision f16,f32 --repetitions 10 --no-progress --output /tmp/gemm-mps-after.csv
```

Then compare with the `bench-compare` skill (`/bench-compare /tmp/gemm-mps-before.csv /tmp/gemm-mps-after.csv`).
Expected: every row's `abs(delta_pct) <= 2 * noise_pct`. If one isn't, rerun both files once; M1 Pro background load is a known noise source. A reproducible regression means `encode` or the loop changed the GPU-only window, so fix it before continuing.

- [ ] **Step 10: Commit**

```bash
git add benchmark/src/kernels benchmark/src/plan.rs benchmark/src/benchmark.rs
git commit -m "Move the Metal setup into kernels/metal and time MPS end to end

MpsGemm now encodes into a shared time_dispatch loop that returns
GPU-only and end-to-end samples and checks the command buffer status.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Review note: this task changes unsafe objc2 Metal FFI. Run the project's `adversarial-reviewer` agent on the diff before moving on.

---

### Task 2: `gemm.metal` and the `metal-naive` shader kernel

**Files:**
- Create: `benchmark/src/kernels/metal/gemm.metal`
- Create: `benchmark/src/kernels/metal/shader.rs`
- Modify: `benchmark/src/kernels/metal/mod.rs` (declare `shader`, re-export)
- Modify: `benchmark/src/kernels/mod.rs` (re-export, tests)

**Interfaces:**
- Consumes: `MetalContext::new`, `GpuOperands` fields, `GpuDispatch<T>`, `GpuSamples`, `time_dispatch` (Task 1)
- Produces:
  - `pub enum Shader { Naive }` (`Clone, Copy, Debug, Eq, PartialEq`); Task 3 adds `Tiled`
  - `pub struct ShaderGemm<T: Element>`
  - `ShaderGemm::<T>::new(shader: Shader) -> Result<Option<Self>, String>`: `Ok(None)` without a device or for f64
  - `ShaderGemm::<T>::benchmark(&self, lhs, rhs, output, repetitions) -> Result<GpuSamples, String>`
  - `impl GemmKernel<T> for ShaderGemm<T>`
  - Re-exported as `gemm_bench::kernels::{Shader, ShaderGemm}`

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernels/mod.rs`, inside `mod tests`, after `mps_benchmark_times_every_repetition_both_ways`, add:

```rust
    /// Checks a shader against `NaiveGemm` at n = 7 and at n = 37, which is
    /// not a multiple of `metal-tiled`'s 16-wide tile, so edge tiles are partial.
    #[cfg(target_os = "macos")]
    fn shader_matches_naive<T: Element>(shader: super::Shader) {
        for n in [7, 37] {
            let (lhs, rhs) = inputs::<T>(n);
            let mut expected = Matrix::zeros(n, n);
            NaiveGemm.compute(&lhs, &rhs, &mut expected);
            let kernel = super::ShaderGemm::<T>::new(shader)
                .expect("gemm.metal should compile")
                .expect("a Metal device and a precision MSL supports");
            let mut actual = Matrix::zeros(n, n);
            kernel.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_naive_matches_naive_at_every_gpu_precision() {
        use super::Shader::Naive;
        shader_matches_naive::<f16>(Naive);
        shader_matches_naive::<f32>(Naive);
        shader_matches_naive::<i32>(Naive);
        shader_matches_naive::<i64>(Naive);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shaders_have_no_kernel_for_f64() {
        let kernel = super::ShaderGemm::<f64>::new(super::Shader::Naive)
            .expect("an unsupported precision is not a compile error");
        assert!(kernel.is_none());
    }
```

(`assert_close` tolerates `8·ε` relative. Integers have `ε = 0`, so `i32`/`i64` must match exactly.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml metal_`
Expected: FAIL to compile: `cannot find type `ShaderGemm` in module `super``.

- [ ] **Step 3: Create `benchmark/src/kernels/metal/gemm.metal`**

```metal
// GEMM compute shaders for the `metal-naive` and `metal-tiled` kernels.
// Compiled from source at runtime by `shader.rs`; each kernel is a template
// instantiated below once per element type, named gemm_<shader>_<type>.
//
// All matrices are n×n, row-major. Buffers: 0 = A, 1 = B, 2 = C; n at 3.
// The accumulator is T, so half sums in half, the same as the CPU kernels.

#include <metal_stdlib>
using namespace metal;

// One thread per output element. gid.x is the column j and gid.y the row i,
// so neighbouring threads read neighbouring B[k*n + j] and share A[i*n + k].
template <typename T>
kernel void gemm_naive(device const T* a [[buffer(0)]],
                       device const T* b [[buffer(1)]],
                       device T* c [[buffer(2)]],
                       constant uint& n [[buffer(3)]],
                       uint2 gid [[thread_position_in_grid]]) {
    if (gid.x >= n || gid.y >= n) return;
    T acc = 0;
    for (uint k = 0; k < n; ++k) {
        acc += a[gid.y * n + k] * b[k * n + gid.x];
    }
    c[gid.y * n + gid.x] = acc;
}

template [[host_name("gemm_naive_half")]] kernel void gemm_naive<half>(
    device const half*, device const half*, device half*, constant uint&, uint2);
template [[host_name("gemm_naive_float")]] kernel void gemm_naive<float>(
    device const float*, device const float*, device float*, constant uint&, uint2);
template [[host_name("gemm_naive_int")]] kernel void gemm_naive<int>(
    device const int*, device const int*, device int*, constant uint&, uint2);
template [[host_name("gemm_naive_long")]] kernel void gemm_naive<long>(
    device const long*, device const long*, device long*, constant uint&, uint2);
```

- [ ] **Step 4: Create `benchmark/src/kernels/metal/shader.rs`**

```rust
//! Hand-written GEMM compute shaders (`gemm.metal`), compiled from source at
//! runtime: the GPU counterparts of the CPU naive and tiled kernels.

use std::any::TypeId;
use std::marker::PhantomData;
use std::ptr::NonNull;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_foundation::NSString;
use objc2_metal::{
    MTLCommandBuffer, MTLCommandEncoder, MTLComputeCommandEncoder, MTLComputePipelineState,
    MTLDevice, MTLLibrary, MTLSize,
};

use super::{GpuDispatch, GpuOperands, GpuSamples, MetalContext, time_dispatch};
use crate::kernels::GemmKernel;
use crate::{Element, Matrix};

/// ponytail: compiled per kernel instance (~17 ms, untimed); cache the
/// library per process if setup time ever matters.
const SOURCE: &str = include_str!("gemm.metal");

/// Which `gemm.metal` kernel to run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Shader {
    /// One thread per output element, reading straight from device memory.
    Naive,
}

impl Shader {
    fn name(self) -> &'static str {
        match self {
            Self::Naive => "naive",
        }
    }
}

/// The MSL element type for `T`, which names the shader instantiation.
/// `None` for `f64`: Apple GPUs have no `double`.
fn msl_type<T: 'static>() -> Option<&'static str> {
    let id = TypeId::of::<T>();
    [
        (TypeId::of::<f16>(), "half"),
        (TypeId::of::<f32>(), "float"),
        (TypeId::of::<i32>(), "int"),
        (TypeId::of::<i64>(), "long"),
    ]
    .into_iter()
    .find_map(|(ty, name)| (ty == id).then_some(name))
}

/// A `gemm.metal` shader, compiled and ready to dispatch at precision `T`.
pub struct ShaderGemm<T: Element> {
    context: MetalContext,
    pipeline: Retained<ProtocolObject<dyn MTLComputePipelineState>>,
    shader: Shader,
    _marker: PhantomData<T>,
}

impl<T: Element> ShaderGemm<T> {
    /// Compiles `gemm.metal` and builds the pipeline for `shader` at `T`.
    /// `Ok(None)` without a Metal device or for a precision MSL can't express
    /// (`f64`); `Err` with the compiler's message if compilation fails.
    pub fn new(shader: Shader) -> Result<Option<Self>, String> {
        let Some(msl_type) = msl_type::<T>() else {
            return Ok(None);
        };
        let Some(context) = MetalContext::new() else {
            return Ok(None);
        };
        let library = context
            .device
            .newLibraryWithSource_options_error(&NSString::from_str(SOURCE), None)
            .map_err(|error| format!("gemm.metal failed to compile: {}", error.localizedDescription()))?;
        let name = format!("gemm_{}_{msl_type}", shader.name());
        let function = library
            .newFunctionWithName(&NSString::from_str(&name))
            .ok_or_else(|| format!("gemm.metal has no function {name}"))?;
        let pipeline = context
            .device
            .newComputePipelineStateWithFunction_error(&function)
            .map_err(|error| format!("{name} pipeline failed: {}", error.localizedDescription()))?;
        Ok(Some(Self {
            context,
            pipeline,
            shader,
            _marker: PhantomData,
        }))
    }

    /// Times `repetitions` dispatches after one untimed warm-up; see
    /// [`time_dispatch`](super::time_dispatch).
    pub fn benchmark(
        &self,
        lhs: &Matrix<T>,
        rhs: &Matrix<T>,
        output: &mut Matrix<T>,
        repetitions: usize,
    ) -> Result<GpuSamples, String> {
        time_dispatch(self, lhs, rhs, output, repetitions)
    }
}

impl<T: Element> GpuDispatch<T> for ShaderGemm<T> {
    fn context(&self) -> &MetalContext {
        &self.context
    }

    fn encode(
        &self,
        cmd_buf: &ProtocolObject<dyn MTLCommandBuffer>,
        operands: &GpuOperands<T>,
    ) -> Result<(), String> {
        let encoder = cmd_buf
            .computeCommandEncoder()
            .ok_or("failed to create a Metal compute encoder")?;
        encoder.setComputePipelineState(&self.pipeline);
        let n = u32::try_from(operands.n).map_err(|_| "n does not fit the shader's uint")?;
        // SAFETY: indices 0-3 match the [[buffer(i)]] slots in gemm.metal, and
        // `setBytes` copies `n` before this call returns.
        unsafe {
            encoder.setBuffer_offset_atIndex(Some(&*operands.lhs), 0, 0);
            encoder.setBuffer_offset_atIndex(Some(&*operands.rhs), 0, 1);
            encoder.setBuffer_offset_atIndex(Some(&*operands.output), 0, 2);
            encoder.setBytes_length_atIndex(NonNull::from(&n).cast(), size_of::<u32>(), 3);
        }
        let square = |side: usize| MTLSize {
            width: side,
            height: side,
            depth: 1,
        };
        match self.shader {
            Shader::Naive => {
                // One SIMD-group wide, as tall as the pipeline allows (32×32 on M1 Pro).
                let width = self.pipeline.threadExecutionWidth();
                let height = self.pipeline.maxTotalThreadsPerThreadgroup() / width;
                encoder.dispatchThreads_threadsPerThreadgroup(
                    square(operands.n),
                    MTLSize {
                        width,
                        height,
                        depth: 1,
                    },
                );
            }
        }
        encoder.endEncoding();
        Ok(())
    }
}

impl<T: Element> GemmKernel<T> for ShaderGemm<T> {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        // Zero repetitions: just the untimed dispatch and the copy back.
        self.benchmark(lhs, rhs, output, 0)
            .expect("the shader dispatch failed");
    }
}
```

- [ ] **Step 5: Wire up the module and re-exports**

In `benchmark/src/kernels/metal/mod.rs`, after `pub mod mps;` add `pub mod shader;`, and after `pub use mps::MpsGemm;` add `pub use shader::{Shader, ShaderGemm};`.

In `benchmark/src/kernels/mod.rs`, replace:

```rust
#[cfg(target_os = "macos")]
pub use metal::MpsGemm;
```

with:

```rust
#[cfg(target_os = "macos")]
pub use metal::{MpsGemm, Shader, ShaderGemm};
```

- [ ] **Step 6: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml metal_`
Expected: PASS for `metal_naive_matches_naive_at_every_gpu_precision` and `metal_shaders_have_no_kernel_for_f64`.

If a shader fails to compile, the `Err` message quotes the MSL compiler. Fix `gemm.metal` and rerun.

Run: `just check-bench`
Expected: no warnings. The `ShaderGemm`/`Shader` re-exports are `pub` library items, so they don't trigger dead-code warnings even though the binary doesn't use them yet.

- [ ] **Step 7: Commit**

```bash
git add benchmark/src/kernels
git commit -m "Add a naive Metal compute shader GEMM for f16, f32, i32 and i64

gemm.metal is a template instantiated per element type and compiled
from source at runtime; ShaderGemm plugs into the shared time_dispatch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `metal-tiled` shader

**Files:**
- Modify: `benchmark/src/kernels/metal/gemm.metal` (append `gemm_tiled`)
- Modify: `benchmark/src/kernels/metal/shader.rs` (`Shader::Tiled`, `TILE`, dispatch arm)
- Modify: `benchmark/src/kernels/mod.rs` (test)

**Interfaces:**
- Consumes: `Shader`, `ShaderGemm`, `shader_matches_naive` test helper (Task 2)
- Produces: `Shader::Tiled`; `const TILE: usize = 16` in `shader.rs`, which must equal `TS` in `gemm.metal`

**Contribution point:** if you're executing this interactively with the user, offer them the body of the `for (uint t …)` loop (two guarded loads, a barrier, the 16-term sum, a second barrier) before writing it, then check their version with the test in Step 1. The code below is the reference implementation.

- [ ] **Step 1: Write the failing test**

In `benchmark/src/kernels/mod.rs`, after `metal_naive_matches_naive_at_every_gpu_precision`, add:

```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn metal_tiled_matches_naive_at_every_gpu_precision() {
        use super::Shader::Tiled;
        shader_matches_naive::<f16>(Tiled);
        shader_matches_naive::<f32>(Tiled);
        shader_matches_naive::<i32>(Tiled);
        shader_matches_naive::<i64>(Tiled);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml metal_tiled`
Expected: FAIL to compile: `no variant named `Tiled` found for enum `Shader``.

- [ ] **Step 3: Append `gemm_tiled` to `gemm.metal`**

```metal

// Must equal TILE in shader.rs, which dispatches TS×TS threadgroups.
constant constexpr uint TS = 16;

// Each TS×TS threadgroup computes one TS×TS block of C. Per step it stages
// one tile of A and one of B in threadgroup memory, so every device-memory
// element is read once per threadgroup instead of once per thread.
template <typename T>
kernel void gemm_tiled(device const T* a [[buffer(0)]],
                       device const T* b [[buffer(1)]],
                       device T* c [[buffer(2)]],
                       constant uint& n [[buffer(3)]],
                       uint2 gid [[thread_position_in_grid]],
                       uint2 lid [[thread_position_in_threadgroup]]) {
    threadgroup T a_tile[TS][TS];
    threadgroup T b_tile[TS][TS];
    T acc = 0;
    // No early return for threads past the edge: they must still load (zeros)
    // and reach every barrier, or the threadgroup's behaviour is undefined.
    for (uint t = 0; t < n; t += TS) {
        uint a_col = t + lid.x;
        uint b_row = t + lid.y;
        a_tile[lid.y][lid.x] = (gid.y < n && a_col < n) ? a[gid.y * n + a_col] : T(0);
        b_tile[lid.y][lid.x] = (b_row < n && gid.x < n) ? b[b_row * n + gid.x] : T(0);
        threadgroup_barrier(mem_flags::mem_threadgroup);
        for (uint k = 0; k < TS; ++k) {
            acc += a_tile[lid.y][k] * b_tile[k][lid.x];
        }
        // Nobody overwrites a tile until every thread has finished reading it.
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    if (gid.x < n && gid.y < n) {
        c[gid.y * n + gid.x] = acc;
    }
}

template [[host_name("gemm_tiled_half")]] kernel void gemm_tiled<half>(
    device const half*, device const half*, device half*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_float")]] kernel void gemm_tiled<float>(
    device const float*, device const float*, device float*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_int")]] kernel void gemm_tiled<int>(
    device const int*, device const int*, device int*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_long")]] kernel void gemm_tiled<long>(
    device const long*, device const long*, device long*, constant uint&, uint2, uint2);
```

- [ ] **Step 4: Add `Shader::Tiled` in `shader.rs`**

After the `SOURCE` constant, add:

```rust
/// Side of `gemm_tiled`'s square tile and threadgroup; must equal `TS` in
/// `gemm.metal`. 16×16 = 256 threads, inside every Apple GPU's 1024 limit.
const TILE: usize = 16;
```

Add the variant to `Shader`:

```rust
    /// Threadgroup-memory tiling with a fixed `TILE`×`TILE` tile.
    Tiled,
```

Add its arm to `Shader::name`:

```rust
            Self::Tiled => "tiled",
```

Add its arm to the `match self.shader` in `encode`, after the `Shader::Naive` arm:

```rust
            // Whole threadgroups: edge threads load zeros instead of returning,
            // so every thread reaches the kernel's barriers.
            Shader::Tiled => encoder.dispatchThreadgroups_threadsPerThreadgroup(
                square(operands.n.div_ceil(TILE)),
                square(TILE),
            ),
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml metal_`
Expected: PASS for all three `metal_` tests.

Run: `just check-bench`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add benchmark/src/kernels
git commit -m "Add a threadgroup-tiled Metal compute shader GEMM

16x16 tiles staged in threadgroup memory, zero-padded at the edges so
every thread reaches both barriers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Review note: run the project's `hpc-specialist` agent on `gemm.metal` and `shader.rs` (coalescing, barrier placement, threadgroup sizing).

---

### Task 4: Emit an `-e2e` record for every Metal run

**Files:**
- Modify: `benchmark/src/benchmark.rs` (`Samples`, `sample`, `measure`, `run_precision`, tests)

**Interfaces:**
- Consumes: `MpsGemm::benchmark -> Result<GpuSamples, String>` (Task 1)
- Produces (private to `benchmark.rs`):
  - `struct Samples { timed: Vec<Duration>, e2e: Option<Vec<Duration>> }` with `impl From<GpuSamples> for Samples` (macOS)
  - `fn measure<T: Element>(…) -> Result<Samples, Box<dyn std::error::Error>>` (same parameters as today)
  - `fn sample<T: Element>(…) -> Samples` (was `-> Vec<Duration>`)

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/benchmark.rs`, `mod tests`: add `measure` to the `use super::{…}` list, add `use crate::kernel::KernelChoice;`, then append:

```rust
    #[test]
    fn cpu_kernels_have_no_end_to_end_samples() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::Ikj, 1, None, 2, &lhs, &rhs, &mut output)
            .expect("ikj should run");
        assert_eq!(samples.timed.len(), 2);
        assert!(samples.e2e.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_kernels_time_the_gpu_and_the_round_trip() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::Mps, 1, None, 2, &lhs, &rhs, &mut output)
            .expect("mps should run");
        let e2e = samples.e2e.expect("a Metal kernel records end-to-end samples");
        assert_eq!((samples.timed.len(), e2e.len()), (2, 2));
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml -- end_to_end round_trip`
Expected: FAIL to compile: `no field `timed` on type `Vec<Duration>``.

- [ ] **Step 3: Add `Samples` and return it from `sample` and `measure`**

In `benchmark/src/benchmark.rs`, change the macOS import to:

```rust
#[cfg(target_os = "macos")]
use gemm_bench::kernels::{AccelerateBlasGemm, AccelerateBnnsGemm, MpsGemm, metal::GpuSamples};
```

Add, just above `fn measure`:

```rust
/// One configuration's timed runs. Metal kernels also time the round trip
/// (upload, encode, dispatch, download), reported as a second `-e2e` record.
struct Samples {
    timed: Vec<Duration>,
    e2e: Option<Vec<Duration>>,
}

#[cfg(target_os = "macos")]
impl From<GpuSamples> for Samples {
    fn from(samples: GpuSamples) -> Self {
        Self {
            timed: samples.gpu,
            e2e: Some(samples.e2e),
        }
    }
}
```

Change `measure`'s return type to `Result<Samples, Box<dyn std::error::Error>>`, and replace the MPS arm with:

```rust
        // Metal kernels time the GPU dispatch and the round trip in their own loop.
        #[cfg(target_os = "macos")]
        KernelChoice::Mps => MpsGemm::<T>::new()
            .expect("MPS needs a Metal device and f16 or f32")
            .benchmark(lhs, rhs, io.2, repetitions)?
            .into(),
```

Change `sample` to return `Samples`:

```rust
/// One untimed warm-up run, then `repetitions` timed ones.
fn sample<T: Element>(
    kernel: &impl GemmKernel<T>,
    (lhs, rhs, output, repetitions): (&Matrix<T>, &Matrix<T>, &mut Matrix<T>, usize),
) -> Samples {
    kernel.compute(lhs, rhs, output);
    Samples {
        timed: (0..repetitions)
            .map(|_| time_kernel(kernel, lhs, rhs, output))
            .collect(),
        e2e: None,
    }
}
```

- [ ] **Step 4: Push one record per sample set in `run_precision`**

In `run_precision`, replace everything from `let stats = summarize(&samples);` to the end of the `records.push(BenchmarkRecord { … });` call with:

```rust
                // Both records come from the same runs, so they share one accuracy.
                let mean_rel_error_f64 = mean_relative_error(&output, &truth);
                let e2e_label = format!("{}-e2e", kernel.label());
                let runs = std::iter::once((kernel.label(), &samples.timed))
                    .chain(samples.e2e.as_ref().map(|e2e| (e2e_label.as_str(), e2e)));
                for (label, timed) in runs {
                    let stats = summarize(timed);
                    let gops = 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9;
                    records.push(BenchmarkRecord {
                        kernel: label.to_owned(),
                        backend: kernel.backend(),
                        device: plan.devices.of(kernel).to_owned(),
                        precision: precision.label(),
                        n,
                        threads: thread_count,
                        gops,
                        mean_rel_error_f64,
                        median_ms: stats.median_ms,
                        min_ms: stats.min_ms,
                        stddev_ms: stats.stddev_ms,
                        block_size,
                        repetitions: plan.repetitions,
                        host: plan.context.host.clone(),
                        commit: plan.context.commit.clone(),
                        timestamp: plan.context.timestamp.clone(),
                    });
                }
```

The progress bar still steps once per `measure` call, so `total_configurations` stays unchanged.

- [ ] **Step 5: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS.

Run: `just check-bench`
Expected: no warnings.

- [ ] **Step 6: Smoke-check the CSV**

```bash
just bench --sizes 64 --kernel mps,ikj --precision f32 --no-progress --output /tmp/gemm-e2e-smoke.csv && cut -d, -f1,2 /tmp/gemm-e2e-smoke.csv
```

Expected: rows `ikj,cpu`, `mps,metal`, `mps-e2e,metal` (after the header).

- [ ] **Step 7: Commit**

```bash
git add benchmark/src/benchmark.rs
git commit -m "Record an -e2e row next to every Metal kernel's GPU-only row

Both come from the same repetitions: the plain label times commit to
completion, the -e2e label adds the copies and the encoding.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `metal-naive` / `metal-tiled` kernel choices, device lookup, CLI tests, docs

**Files:**
- Modify: `benchmark/src/kernel.rs` (variants, `info` rows, backend test)
- Modify: `benchmark/src/plan.rs` (`Devices`, its test)
- Modify: `benchmark/src/benchmark.rs` (imports, two `measure` arms)
- Modify: `benchmark/src/cli.rs` (tests)
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `ShaderGemm`, `Shader::{Naive, Tiled}` (Tasks 2–3), `Samples: From<GpuSamples>` (Task 4)
- Produces: `KernelChoice::MetalNaive` (`metal-naive`), `KernelChoice::MetalTiled` (`metal-tiled`)

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/cli.rs`, `mod tests`, after `mps_parses_as_a_kernel_choice`, add:

```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shader_kernels_run_every_gpu_precision_on_the_gpu() {
        let plan = plan_for(
            "metal-shaders",
            &["--kernel", "metal-naive,metal-tiled", "--sizes", "64"],
        )
        .expect("metal shader plan should be valid");

        assert_eq!(
            plan.kernels,
            [KernelChoice::MetalNaive, KernelChoice::MetalTiled]
        );
        assert_ne!(plan.devices.metal, "unknown", "a Mac with Metal must name its GPU");
        assert_eq!(plan.devices.of(KernelChoice::MetalTiled), plan.devices.metal);
        // 1 size * 2 kernels * (f16, f32, i32, i64); f64 is skipped.
        assert_eq!(plan.total_configurations(), 8);
    }
```

In `a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running`, extend the array:

```rust
        for (kernel, precision) in [
            ("mps", "f64"),
            ("mps", "i32"),
            ("metal-naive", "f64"),
            ("metal-tiled", "f64"),
            ("accelerate-blas", "f16"),
            ("accelerate-bnns", "f64"),
        ] {
```

In `default_kernels_skip_mps_at_precisions_it_lacks`, the default kernel list now includes the shaders, so extend `plan.skipped`:

```rust
        assert_eq!(
            plan.skipped,
            [
                "skipping accelerate-bnns at f64 (unsupported precision)",
                "skipping mps at f64 (unsupported precision)",
                "skipping metal-naive at f64 (unsupported precision)",
                "skipping metal-tiled at f64 (unsupported precision)"
            ]
        );
```

In `benchmark/src/kernel.rs`, `every_kernel_names_its_backend`, replace `if kernel == KernelChoice::Mps {` with:

```rust
            if matches!(
                kernel,
                KernelChoice::Mps | KernelChoice::MetalNaive | KernelChoice::MetalTiled
            ) {
```

In `benchmark/src/plan.rs`, `kernels_report_the_device_of_their_backend`, after the `Mps` assertion add:

```rust
        #[cfg(target_os = "macos")]
        assert_eq!(devices.of(KernelChoice::MetalNaive), "Test GPU");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: FAIL to compile: `no variant named `MetalNaive` found for enum `KernelChoice``.

- [ ] **Step 3: Add the kernel choices**

In `benchmark/src/kernel.rs`, after the `Mps` variant of `KernelChoice`, add:

```rust
    #[cfg(target_os = "macos")]
    MetalNaive,
    #[cfg(target_os = "macos")]
    MetalTiled,
```

Change the `use` at the top of `KernelChoice::info` to `use Precision::{F16, F32, F64, I32, I64};`, and add after the `Self::Mps` row:

```rust
            // Hand-written shaders: MSL has half, float, int and long, but no double.
            #[cfg(target_os = "macos")]
            Self::MetalNaive => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                ..serial("metal-naive")
            },
            #[cfg(target_os = "macos")]
            Self::MetalTiled => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                ..serial("metal-tiled")
            },
```

(`metal-tiled` has a fixed 16×16 tile and doesn't sweep `--block-size`, so it keeps `blocks: false` from `serial`.)

- [ ] **Step 4: Key `Devices` on the backend**

In `benchmark/src/plan.rs`, `Devices::lookup`, replace `.contains(&KernelChoice::Mps)` with:

```rust
                .iter()
                .any(|kernel| kernel.backend() == "metal")
```

In `Devices::of`, replace `if kernel == KernelChoice::Mps {` with `if kernel.backend() == "metal" {`. Update both doc comments that mention MPS to say "the Metal kernels".

- [ ] **Step 5: Add the `measure` arms**

In `benchmark/src/benchmark.rs`, change the macOS import to:

```rust
#[cfg(target_os = "macos")]
use gemm_bench::kernels::{
    AccelerateBlasGemm, AccelerateBnnsGemm, MpsGemm, Shader, ShaderGemm, metal::GpuSamples,
};
```

After the `KernelChoice::Mps` arm in `measure`, add:

```rust
        #[cfg(target_os = "macos")]
        KernelChoice::MetalNaive => ShaderGemm::<T>::new(Shader::Naive)?
            .expect("metal-naive needs a Metal device and f16, f32, i32 or i64")
            .benchmark(lhs, rhs, io.2, repetitions)?
            .into(),
        #[cfg(target_os = "macos")]
        KernelChoice::MetalTiled => ShaderGemm::<T>::new(Shader::Tiled)?
            .expect("metal-tiled needs a Metal device and f16, f32, i32 or i64")
            .benchmark(lhs, rhs, io.2, repetitions)?
            .into(),
```

- [ ] **Step 6: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS.

Run: `just check-bench`
Expected: no warnings.

- [ ] **Step 7: Update `README.md`**

Line 30, replace `The `mps` GPU kernel and the` with `The `mps`, `metal-naive` and `metal-tiled` GPU kernels and the`.

In the "Apple Silicon GPU (macOS only)" table, replace the `mps` row's last sentence group `The timed region is GPU execution only (`commit` → `waitUntilCompleted`); buffer copies and command encoding are excluded.` with `The timed region is GPU execution only (`commit` → `waitUntilCompleted`); an `mps-e2e` record from the same runs adds the buffer copies and command encoding (see Methodology).` Then add two rows after it:

```markdown
| `metal-naive` | Hand-written Metal compute shader (`benchmark/src/kernels/metal/gemm.metal`), compiled from source at runtime | One GPU thread per output element, reading A and B straight from device memory. Supports `f16`, `f32`, `i32` and `i64` (MSL `half`, `float`, `int`, `long`; Apple GPUs have no `double`). Accumulates in the element type, like the CPU kernels; `i64` multiplies are emulated in software on Apple GPUs. Timed like `mps`, with a `metal-naive-e2e` record. |
| `metal-tiled` | Same shader source | Each 16×16 threadgroup stages one tile of A and one of B in threadgroup memory per step, so each device-memory element is read once per threadgroup instead of once per thread. The tile is fixed; `--block-size` does not apply. Same precisions, accumulation and timing as `metal-naive`, with a `metal-tiled-e2e` record. |
```

Rename the heading `#### Apple Silicon GPU (MPS)` to `#### Apple Silicon GPU`, and change its command to:

```sh
just bench \
  --sizes 256,512,1024,2048 \
  --kernel mps,metal-naive,metal-tiled \
  --precision f16,f32
```

In Methodology item 2 (**Timing Statistics**), append: ` Metal kernels produce two records per configuration from the same repetitions: the plain label times GPU execution only (`commit` → `waitUntilCompleted`), and `<label>-e2e` also includes copying the inputs into the shared buffers, encoding the command buffer, and copying the result back. Both carry the same accuracy.`

In Methodology item 4, replace ``accelerate-bnns` or `mps` outside `f16`/`f32`,` with ``accelerate-bnns` or `mps` outside `f16`/`f32`, `metal-naive`/`metal-tiled` at `f64`,`.

- [ ] **Step 8: Update `CLAUDE.md`**

Replace the line:

```markdown
- `mps` is macOS/Apple Silicon only, `f16`/`f32` only, and is compiled only locally (CI is Linux). Gate new macOS code with `#[cfg(target_os = "macos")]` and check `cargo clippy` still passes for the non-macOS shape.
```

with:

```markdown
- Metal kernels (`mps`, `metal-naive`, `metal-tiled`, all under `kernels/metal/`) are macOS/Apple Silicon only and compiled only locally (CI is Linux). `mps` runs `f16`/`f32`; the shaders also run `i32`/`i64`. `gemm.metal` is compiled from source at runtime, so shader errors show up in `cargo test`, not `cargo build`. Gate new macOS code with `#[cfg(target_os = "macos")]` and check `cargo clippy` still passes for the non-macOS shape.
```

- [ ] **Step 9: Commit**

```bash
git add benchmark/src README.md CLAUDE.md
git commit -m "Expose metal-naive and metal-tiled as kernel choices

Both run f16, f32, i32 and i64 on the GPU; the device lookup now keys
on the metal backend instead of the mps kernel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Real run and final checks

**Files:** none (verification only)

- [ ] **Step 1: Full checks**

Run: `just check && just test`
Expected: PASS, no warnings.

- [ ] **Step 2: Run the GPU progression**

```bash
just bench --sizes 256,1024,2048 --kernel mps,metal-naive,metal-tiled --precision f16,f32,i32,i64 --no-progress --output /tmp/gemm-metal.csv
```

Expected: the run completes without a verification error. It skips `mps` at `i32`/`i64` with a notice.

- [ ] **Step 3: Check the ordering and the e2e rows**

```bash
duckdb -markdown -c "SELECT kernel, precision, n, round(gops, 1) AS gops, round(median_ms, 2) AS median_ms FROM read_csv('/tmp/gemm-metal.csv') ORDER BY precision, n, gops"
```

Expected:
- Every plain label has a matching `-e2e` row with a larger `median_ms`.
- At n=1024 and n=2048, for f16/f32: `metal-naive` < `metal-tiled` < `mps` in `gops`. For reference, the probe measured naive at ~310–415 GOPS at n=2048.
- `i64` is slower than `i32` for both shaders (software-emulated 64-bit multiply), with a larger gap for `metal-tiled`.

If `metal-tiled` isn't faster than `metal-naive`, don't tune it in this plan. Report the numbers to the user; tile size and register blocking are follow-ups.

- [ ] **Step 4: Hand off**

Report the table to the user. Committing a real run to `data/runs/` (with default `--output`) and the dashboard palette for the five new labels are the user's decisions; see the spec's Non-Goals.

//! Hand-written GEMM compute shaders (`gemm.metal`), compiled from source at
//! runtime: the GPU counterparts of the CPU naive and tiled kernels, and a
//! `simdgroup_matrix` kernel that multiplies 8×8 fragments.

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
use crate::kernels::{GemmKernel, Param};
use crate::{Element, Matrix};

/// ponytail: compiled per kernel instance (~17 ms, untimed); cache the
/// library per process if setup time ever matters.
const SOURCE: &str = include_str!("gemm.metal");

/// Side of `gemm_tiled`'s square tile and threadgroup; must equal `TS` in
/// `gemm.metal`. 16×16 = 256 threads, inside every Apple GPU's 1024 limit.
const TILE: usize = 16;

// `gemm_simdgroup`'s block of C per threadgroup, the depth of each staged
// step, and its simdgroups (2×2); must equal `BM`, `BN`, `BK` and `SG` in
// `gemm.metal`.
const BLOCK_ROWS: usize = 32;
const BLOCK_COLS: usize = 32;
const DEPTH_STEP: usize = 16;
const SIMDGROUPS: usize = 4;
/// `gemm_simdgroup`'s threads per threadgroup: every Apple GPU's simdgroup is
/// 32 threads wide.
const SIMDGROUP_THREADS: usize = SIMDGROUPS * 32;

/// Which `gemm.metal` kernel to run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Shader {
    /// One thread per output element, reading straight from device memory.
    Naive,
    /// Threadgroup-memory tiling with a fixed `TILE`×`TILE` tile.
    Tiled,
    /// 8×8 `simdgroup_matrix` fragments multiplied out of a threadgroup-staged
    /// block, `f16` and `f32` only.
    Simdgroup,
}

impl Shader {
    fn name(self) -> &'static str {
        match self {
            Self::Naive => "naive",
            Self::Tiled => "tiled",
            Self::Simdgroup => "simdgroup",
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
    /// `Ok(None)` without a Metal device or for a precision the shader can't
    /// express (`f64`, and integers for `Simdgroup`); `Err` with the
    /// compiler's message if compilation fails, or if the pipeline can't run
    /// `Simdgroup`'s threadgroup.
    pub fn new(shader: Shader) -> Result<Option<Self>, String> {
        let Some(msl_type) = msl_type::<T>() else {
            return Ok(None);
        };
        // simdgroup_matrix has half and float only.
        if shader == Shader::Simdgroup && !matches!(msl_type, "half" | "float") {
            return Ok(None);
        }
        let Some(context) = MetalContext::new() else {
            return Ok(None);
        };
        let library = context
            .device
            .newLibraryWithSource_options_error(&NSString::from_str(SOURCE), None)
            .map_err(|error| {
                format!(
                    "gemm.metal failed to compile: {}",
                    error.localizedDescription()
                )
            })?;
        let name = format!("gemm_{}_{msl_type}", shader.name());
        let function = library
            .newFunctionWithName(&NSString::from_str(&name))
            .ok_or_else(|| format!("gemm.metal has no function {name}"))?;
        let pipeline = context
            .device
            .newComputePipelineStateWithFunction_error(&function)
            .map_err(|error| format!("{name} pipeline failed: {}", error.localizedDescription()))?;
        let max_threads = pipeline.maxTotalThreadsPerThreadgroup();
        if shader == Shader::Simdgroup && max_threads < SIMDGROUP_THREADS {
            return Err(format!(
                "{name} allows {max_threads} threads per threadgroup but needs {SIMDGROUP_THREADS}"
            ));
        }
        Ok(Some(Self {
            context,
            pipeline,
            shader,
            _marker: PhantomData,
        }))
    }

    /// `metal-naive`'s threadgroup: one SIMD-group wide, as tall as the
    /// pipeline allows (32×32 on M1 Pro).
    fn naive_threadgroup(&self) -> (usize, usize) {
        let width = self.pipeline.threadExecutionWidth();
        (width, self.pipeline.maxTotalThreadsPerThreadgroup() / width)
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
        let n = u32::try_from(operands.n).map_err(|_| "n does not fit the shader's uint")?;
        let encoder = cmd_buf
            .computeCommandEncoder()
            .ok_or("failed to create a Metal compute encoder")?;
        encoder.setComputePipelineState(&self.pipeline);
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
                let (width, height) = self.naive_threadgroup();
                encoder.dispatchThreads_threadsPerThreadgroup(
                    square(operands.n),
                    MTLSize {
                        width,
                        height,
                        depth: 1,
                    },
                );
            }
            // Whole threadgroups: edge threads load zeros instead of returning,
            // so every thread reaches the kernel's barriers.
            Shader::Tiled => encoder.dispatchThreadgroups_threadsPerThreadgroup(
                square(operands.n.div_ceil(TILE)),
                square(TILE),
            ),
            // Whole threadgroups for the same reason; x walks columns, y rows.
            Shader::Simdgroup => encoder.dispatchThreadgroups_threadsPerThreadgroup(
                MTLSize {
                    width: operands.n.div_ceil(BLOCK_COLS),
                    height: operands.n.div_ceil(BLOCK_ROWS),
                    depth: 1,
                },
                MTLSize {
                    width: SIMDGROUP_THREADS,
                    height: 1,
                    depth: 1,
                },
            ),
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

    fn params(&self, n: usize) -> Vec<Param> {
        match self.shader {
            Shader::Naive => {
                let (width, height) = self.naive_threadgroup();
                vec![
                    Param::derived("threadgroup_width", width),
                    Param::derived("threadgroup_height", height),
                    Param::derived("threadgroups", n.div_ceil(width) * n.div_ceil(height)),
                ]
            }
            Shader::Tiled => vec![
                Param::fixed("threadgroup_width", TILE),
                Param::fixed("threadgroup_height", TILE),
                Param::fixed("depth_step", TILE),
                Param::derived("threadgroups", n.div_ceil(TILE).pow(2)),
            ],
            Shader::Simdgroup => vec![
                Param::fixed("block_rows", BLOCK_ROWS),
                Param::fixed("block_cols", BLOCK_COLS),
                Param::fixed("depth_step", DEPTH_STEP),
                Param::fixed("simdgroups", SIMDGROUPS),
                Param::derived(
                    "threadgroups",
                    n.div_ceil(BLOCK_ROWS) * n.div_ceil(BLOCK_COLS),
                ),
            ],
        }
    }
}

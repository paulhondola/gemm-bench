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

/// Side of `gemm_tiled`'s square tile and threadgroup; must equal `TS` in
/// `gemm.metal`. 16×16 = 256 threads, inside every Apple GPU's 1024 limit.
const TILE: usize = 16;

/// Which `gemm.metal` kernel to run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Shader {
    /// One thread per output element, reading straight from device memory.
    Naive,
    /// Threadgroup-memory tiling with a fixed `TILE`×`TILE` tile.
    Tiled,
}

impl Shader {
    fn name(self) -> &'static str {
        match self {
            Self::Naive => "naive",
            Self::Tiled => "tiled",
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
            // Whole threadgroups: edge threads load zeros instead of returning,
            // so every thread reaches the kernel's barriers.
            Shader::Tiled => encoder.dispatchThreadgroups_threadsPerThreadgroup(
                square(operands.n.div_ceil(TILE)),
                square(TILE),
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
}

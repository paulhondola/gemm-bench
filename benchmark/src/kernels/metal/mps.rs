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

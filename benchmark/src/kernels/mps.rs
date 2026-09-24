//! Apple Silicon GPU GEMM kernel using `MetalPerformanceShaders` (`MPSMatrixMultiplication`).

use std::any::TypeId;
use std::marker::PhantomData;
use std::time::{Duration, Instant};

use objc2::AnyThread;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::ProtocolObject;
use objc2_metal::{
    MTLBuffer, MTLCommandBuffer, MTLCommandQueue, MTLCreateSystemDefaultDevice, MTLDevice,
    MTLResourceOptions,
};
use objc2_metal_performance_shaders::{
    MPSDataType, MPSMatrix, MPSMatrixDescriptor, MPSMatrixMultiplication,
};

use crate::Matrix;
use crate::kernels::{Element, GemmKernel, assert_gemm_dimensions};

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

/// Name of the system default Metal device, the one `MpsGemm::new` acquires.
pub fn default_device_name() -> Option<String> {
    MTLCreateSystemDefaultDevice().map(|device| device.name().to_string())
}

/// A dense matrix multiplication kernel leveraging Apple's `MPSMatrixMultiplication`.
pub struct MpsGemm<T: Element> {
    device: Retained<ProtocolObject<dyn MTLDevice>>,
    command_queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
    data_type: MPSDataType,
    _marker: PhantomData<T>,
}

impl<T: Element> MpsGemm<T> {
    /// Creates a new `MpsGemm` instance by acquiring the system default Metal device
    /// and a dedicated command queue. `None` without a Metal device or for a
    /// precision other than `f16`/`f32`.
    pub fn new() -> Option<Self> {
        let data_type = mps_data_type::<T>()?;
        let device = MTLCreateSystemDefaultDevice()?;
        let command_queue = device.newCommandQueue()?;
        Some(Self {
            device,
            command_queue,
            data_type,
            _marker: PhantomData,
        })
    }

    /// Benchmarks matrix multiplication by pre-allocating shared buffers once,
    /// running an untimed warm-up iteration to bring the GPU clock up, and measuring
    /// `repetitions` timed dispatches, returning each dispatch's duration.
    pub fn benchmark(
        &self,
        lhs: &Matrix<T>,
        rhs: &Matrix<T>,
        output: &mut Matrix<T>,
        repetitions: usize,
    ) -> Vec<Duration> {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.rows();
        let count = n * n;
        let elem_size = std::mem::size_of::<T>();
        let byte_len = count * elem_size;
        let row_bytes = n * elem_size;

        autoreleasepool(|_| {
            let buf_a = self
                .device
                .newBufferWithLength_options(byte_len, MTLResourceOptions::StorageModeShared)
                .expect("failed to allocate Metal buffer for LHS");
            let buf_b = self
                .device
                .newBufferWithLength_options(byte_len, MTLResourceOptions::StorageModeShared)
                .expect("failed to allocate Metal buffer for RHS");
            let buf_c = self
                .device
                .newBufferWithLength_options(byte_len, MTLResourceOptions::StorageModeShared)
                .expect("failed to allocate Metal buffer for Output");

            // Copy input matrices into unified shared memory
            unsafe {
                std::ptr::copy_nonoverlapping(
                    lhs.as_slice().as_ptr(),
                    buf_a.contents().as_ptr().cast(),
                    count,
                );
                std::ptr::copy_nonoverlapping(
                    rhs.as_slice().as_ptr(),
                    buf_b.contents().as_ptr().cast(),
                    count,
                );
            }

            let data_type = self.data_type;
            let desc_a = unsafe {
                MPSMatrixDescriptor::matrixDescriptorWithRows_columns_rowBytes_dataType(
                    n, n, row_bytes, data_type,
                )
            };
            let desc_b = unsafe {
                MPSMatrixDescriptor::matrixDescriptorWithRows_columns_rowBytes_dataType(
                    n, n, row_bytes, data_type,
                )
            };
            let desc_c = unsafe {
                MPSMatrixDescriptor::matrixDescriptorWithRows_columns_rowBytes_dataType(
                    n, n, row_bytes, data_type,
                )
            };

            let mat_a = unsafe {
                MPSMatrix::initWithBuffer_descriptor(MPSMatrix::alloc(), &buf_a, &desc_a)
            };
            let mat_b = unsafe {
                MPSMatrix::initWithBuffer_descriptor(MPSMatrix::alloc(), &buf_b, &desc_b)
            };
            let mat_c = unsafe {
                MPSMatrix::initWithBuffer_descriptor(MPSMatrix::alloc(), &buf_c, &desc_c)
            };

            let mps_mul = unsafe {
                MPSMatrixMultiplication::initWithDevice_transposeLeft_transposeRight_resultRows_resultColumns_interiorColumns_alpha_beta(
                    MPSMatrixMultiplication::alloc(),
                    &self.device,
                    false,
                    false,
                    n,
                    n,
                    n,
                    1.0,
                    0.0,
                )
            };

            // Warm-up dispatch
            {
                let cmd_buf = self
                    .command_queue
                    .commandBuffer()
                    .expect("failed to create Metal command buffer");
                unsafe {
                    mps_mul.encodeToCommandBuffer_leftMatrix_rightMatrix_resultMatrix(
                        &cmd_buf, &mat_a, &mat_b, &mat_c,
                    );
                }
                cmd_buf.commit();
                cmd_buf.waitUntilCompleted();
            }

            // Timed repetitions
            let mut samples = Vec::with_capacity(repetitions);
            for _ in 0..repetitions {
                let cmd_buf = self
                    .command_queue
                    .commandBuffer()
                    .expect("failed to create Metal command buffer");
                unsafe {
                    mps_mul.encodeToCommandBuffer_leftMatrix_rightMatrix_resultMatrix(
                        &cmd_buf, &mat_a, &mat_b, &mat_c,
                    );
                }
                let start = Instant::now();
                cmd_buf.commit();
                cmd_buf.waitUntilCompleted();
                samples.push(start.elapsed());
            }

            // Copy result back to CPU output matrix
            unsafe {
                std::ptr::copy_nonoverlapping(
                    buf_c.contents().as_ptr().cast(),
                    output.as_mut_slice().as_mut_ptr(),
                    count,
                );
            }

            samples
        })
    }
}

impl<T: Element> GemmKernel<T> for MpsGemm<T> {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        // Zero repetitions: just the untimed dispatch and the copy back.
        self.benchmark(lhs, rhs, output, 0);
    }
}

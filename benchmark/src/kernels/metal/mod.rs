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
        assert_eq!(lhs.as_slice().len(), count, "lhs does not match n * n");
        assert_eq!(rhs.as_slice().len(), count, "rhs does not match n * n");
        // SAFETY: each buffer holds `n * n` elements of `T` (see `new`), the
        // asserts above confirm `lhs`/`rhs` hold as many, and shared-storage
        // buffers are CPU-addressable.
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
        let count = self.n * self.n;
        assert_eq!(
            output.as_slice().len(),
            count,
            "output does not match n * n"
        );
        // SAFETY: the assert above confirms `output` holds `n * n` elements of
        // `T`, matching the buffer (see `new`); no command buffer is in
        // flight when this runs.
        unsafe {
            std::ptr::copy_nonoverlapping(
                self.output.contents().as_ptr().cast(),
                output.as_mut_slice().as_mut_ptr(),
                count,
            );
        }
    }
}

/// A GPU kernel the shared timing loop can drive.
pub(crate) trait GpuDispatch<T: Element> {
    fn context(&self) -> &MetalContext;

    /// Records one `output = lhs * rhs` into `cmd_buf`, without committing it.
    ///
    /// Contract for implementors:
    /// - Any encoder opened on `cmd_buf` must be `endEncoding()`'d before
    ///   this returns; committing with an open encoder aborts the process.
    /// - `encode` must never commit, wait on, or create command buffers
    ///   itself — that would break the gpu/e2e timing split, and
    ///   `time_dispatch` commits `cmd_buf` right after this returns, so a
    ///   second commit here aborts the process too.
    /// - Dispatches must stay within `operands.n` × `operands.n`.
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

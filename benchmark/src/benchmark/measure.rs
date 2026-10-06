use std::{
    hint::black_box,
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
use gemm_bench::kernels::{
    AccelerateBlasGemm, AccelerateBnnsGemm, MpsGemm, Shader, ShaderGemm, metal::GpuSamples,
};
use gemm_bench::{
    Element, GemmKernel, Matrix,
    kernels::{
        IkjGemm, NaiveGemm, PackedGemm, Param, RayonIkjGemm, RayonPackedGemm, RayonTiledGemm,
        StaticIkjGemm, StaticTiledGemm, TiledGemm,
    },
};
use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::kernel::KernelChoice;

/// One configuration's measurements. `timed` is what a caller waits for per
/// run: one `compute` call, or a Metal kernel's whole round trip (upload,
/// encode, dispatch, download), with its GPU execution alone in `gpu`.
/// `setup` is the one-time cost of building the kernel, taken once.
pub(crate) struct Samples {
    pub(crate) timed: Vec<Duration>,
    pub(crate) gpu: Option<Vec<Duration>>,
    pub(crate) setup: Duration,
    /// The knob values the kernel reported for this configuration.
    pub(crate) params: Vec<Param>,
}

/// A Metal kernel's round trip and GPU window, with its buffer allocation
/// added to the time it took to build the kernel.
#[cfg(target_os = "macos")]
fn on_gpu(built: Duration, samples: GpuSamples, params: Vec<Param>) -> Samples {
    Samples {
        timed: samples.e2e,
        gpu: Some(samples.gpu),
        setup: built + samples.setup,
        params,
    }
}

/// Returns the timed runs and the kernel's one-time setup time.
///
/// Kernel setup (a pool, a compiled graph, a Metal device and buffers) happens
/// here, before `sample`'s untimed warm-up run, so one-time costs stay out of
/// the timed samples; they are recorded once, as `setup`.
pub(crate) fn measure<T: Element>(
    choice: KernelChoice,
    threads: usize,
    knob_value: Option<usize>,
    repetitions: usize,
    lhs: &Matrix<T>,
    rhs: &Matrix<T>,
    output: &mut Matrix<T>,
) -> Result<Samples, Box<dyn std::error::Error>> {
    // `BenchmarkPlan::cells` gives every kernel with a knob a value.
    let knob = || knob_value.expect("kernels with a knob always get a value");
    let io = (lhs, rhs, output, repetitions);
    // Each arm builds its kernel before `sample` starts, so the time from here
    // to `sample`'s first line is that kernel's setup.
    let setup_start = Instant::now();
    Ok(match choice {
        KernelChoice::Naive => sample(&NaiveGemm, setup_start, io),
        KernelChoice::Ikj => sample(&IkjGemm, setup_start, io),
        KernelChoice::Tiled => sample(&TiledGemm::new(knob()), setup_start, io),
        KernelChoice::Packed => sample(&PackedGemm::new(knob()), setup_start, io),
        KernelChoice::RayonIkj => sample(&InPool::new(threads, RayonIkjGemm)?, setup_start, io),
        KernelChoice::RayonTiled => sample(
            &InPool::new(threads, RayonTiledGemm::new(knob()))?,
            setup_start,
            io,
        ),
        KernelChoice::RayonPacked => sample(
            &InPool::new(threads, RayonPackedGemm::new(knob()))?,
            setup_start,
            io,
        ),
        KernelChoice::StaticIkj => sample(&StaticIkjGemm::new(threads)?, setup_start, io),
        KernelChoice::StaticTiled => {
            sample(&StaticTiledGemm::new(threads, knob())?, setup_start, io)
        }
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBlas => sample(&AccelerateBlasGemm, setup_start, io),
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBnns => sample(
            &AccelerateBnnsGemm::<T>::new(lhs.rows())
                .expect("accelerate-bnns needs macOS 26 (the BNNSGraph builder)"),
            setup_start,
            io,
        ),
        // Metal kernels time the GPU window and the round trip in their own loop.
        #[cfg(target_os = "macos")]
        KernelChoice::Mps => {
            let kernel = MpsGemm::<T>::new().expect("MPS needs a Metal device and f16 or f32");
            let built = setup_start.elapsed();
            let params = GemmKernel::<T>::params(&kernel, lhs.rows());
            on_gpu(
                built,
                kernel.benchmark(lhs, rhs, io.2, repetitions)?,
                params,
            )
        }
        #[cfg(target_os = "macos")]
        KernelChoice::MetalNaive => {
            let kernel = ShaderGemm::<T>::new(Shader::Naive)?
                .expect("metal-naive needs a Metal device and f16, f32, i32 or i64");
            let built = setup_start.elapsed();
            let params = GemmKernel::<T>::params(&kernel, lhs.rows());
            on_gpu(
                built,
                kernel.benchmark(lhs, rhs, io.2, repetitions)?,
                params,
            )
        }
        #[cfg(target_os = "macos")]
        KernelChoice::MetalTiled => {
            let kernel = ShaderGemm::<T>::new(Shader::Tiled)?
                .expect("metal-tiled needs a Metal device and f16, f32, i32 or i64");
            let built = setup_start.elapsed();
            let params = GemmKernel::<T>::params(&kernel, lhs.rows());
            on_gpu(
                built,
                kernel.benchmark(lhs, rhs, io.2, repetitions)?,
                params,
            )
        }
        #[cfg(target_os = "macos")]
        KernelChoice::MetalSimdgroup => {
            let kernel = ShaderGemm::<T>::new(Shader::Simdgroup)?
                .expect("metal-simdgroup needs a Metal device and f16 or f32");
            let built = setup_start.elapsed();
            let params = GemmKernel::<T>::params(&kernel, lhs.rows());
            on_gpu(
                built,
                kernel.benchmark(lhs, rhs, io.2, repetitions)?,
                params,
            )
        }
        // `value(skip)` keeps these out of every plan off macOS.
        #[cfg(not(target_os = "macos"))]
        KernelChoice::AccelerateBlas
        | KernelChoice::AccelerateBnns
        | KernelChoice::Mps
        | KernelChoice::MetalNaive
        | KernelChoice::MetalTiled
        | KernelChoice::MetalSimdgroup => unreachable!("{} runs only on macOS", choice.label()),
    })
}

/// One untimed warm-up run, then `repetitions` timed ones. `setup_start` is
/// when building `kernel` began, so the time until this call is its setup.
fn sample<T: Element>(
    kernel: &impl GemmKernel<T>,
    setup_start: Instant,
    (lhs, rhs, output, repetitions): (&Matrix<T>, &Matrix<T>, &mut Matrix<T>, usize),
) -> Samples {
    let setup = setup_start.elapsed();
    let params = kernel.params(lhs.rows());
    kernel.compute(lhs, rhs, output);
    Samples {
        timed: (0..repetitions)
            .map(|_| time_kernel(kernel, lhs, rhs, output))
            .collect(),
        gpu: None,
        setup,
        params,
    }
}

/// Runs a Rayon kernel on its own pool of `threads` workers. `install` is
/// part of `compute`, so every timed run includes it.
struct InPool<K> {
    pool: ThreadPool,
    kernel: K,
}

impl<K> InPool<K> {
    fn new(threads: usize, kernel: K) -> Result<Self, rayon::ThreadPoolBuildError> {
        let pool = ThreadPoolBuilder::new().num_threads(threads).build()?;
        Ok(Self { pool, kernel })
    }
}

impl<T: Element, K: GemmKernel<T>> GemmKernel<T> for InPool<K> {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        self.pool.install(|| self.kernel.compute(lhs, rhs, output));
    }

    fn params(&self, n: usize) -> Vec<Param> {
        self.pool.install(|| self.kernel.params(n))
    }
}

fn time_kernel<T: Element>(
    kernel: &impl GemmKernel<T>,
    lhs: &Matrix<T>,
    rhs: &Matrix<T>,
    output: &mut Matrix<T>,
) -> Duration {
    let start = Instant::now();
    kernel.compute(black_box(lhs), black_box(rhs), black_box(output));
    black_box(output.as_slice());
    start.elapsed()
}

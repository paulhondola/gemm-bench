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

use crate::{
    kernel::{KernelChoice, Precision},
    plan::BenchmarkPlan,
    report::BenchmarkProgress,
};

/// One measured configuration, shared by the terminal table and the DB writer.
#[derive(Debug)]
pub(crate) struct BenchmarkRecord {
    pub(crate) kernel: String,
    pub(crate) backend: &'static str,
    pub(crate) precision: &'static str,
    pub(crate) n: usize,
    pub(crate) threads: usize,
    pub(crate) gops: f64,
    pub(crate) mean_rel_error_f64: f64,
    pub(crate) median_ms: f64,
    pub(crate) min_ms: f64,
    pub(crate) stddev_ms: f64,
    /// Median GPU execution (`commit` → `waitUntilCompleted`) inside the
    /// round trip that `median_ms` times. `None` off Metal.
    pub(crate) gpu_ms: Option<f64>,
    /// One-time cost of building the kernel for this configuration, one sample.
    pub(crate) setup_ms: f64,
    /// The knob values the kernel ran with: the terminal table shows the swept one, the DB writer stores them all.
    pub(crate) params: Vec<Param>,
}

pub(crate) fn run(
    plan: &BenchmarkPlan,
) -> Result<Vec<BenchmarkRecord>, Box<dyn std::error::Error>> {
    let mut records = Vec::new();
    let mut progress = BenchmarkProgress::new(plan.total_configurations(), plan.no_progress);

    // Each arm monomorphizes the whole sweep, so kernels compile to native
    // arithmetic for that precision with no per-element dispatch.
    for &precision in &plan.precisions {
        match precision {
            Precision::F16 => run_precision::<f16>(plan, precision, &progress, &mut records)?,
            Precision::F32 => run_precision::<f32>(plan, precision, &progress, &mut records)?,
            Precision::F64 => run_precision::<f64>(plan, precision, &progress, &mut records)?,
            Precision::I32 => run_precision::<i32>(plan, precision, &progress, &mut records)?,
            Precision::I64 => run_precision::<i64>(plan, precision, &progress, &mut records)?,
        }
    }

    progress.finish();
    Ok(records)
}

fn run_precision<T: Element>(
    plan: &BenchmarkPlan,
    precision: Precision,
    progress: &BenchmarkProgress,
    records: &mut Vec<BenchmarkRecord>,
) -> Result<(), Box<dyn std::error::Error>> {
    for &n in &plan.sizes {
        if plan
            .kernels
            .iter()
            .all(|&k| plan.cells(k, precision, n).is_empty())
        {
            continue;
        }
        let (lhs, rhs) = benchmark_inputs::<T>(n);
        let mut output = Matrix::zeros(n, n);
        let mut reference = Matrix::zeros(n, n);
        IkjGemm.compute(&lhs, &rhs, &mut reference);
        // ponytail: for T = f64 this repeats `reference` (~12 s at n=4096);
        // special-case it only if that shows up next to the timed work.
        let truth = f64_reference(&lhs, &rhs);
        let tolerance = tolerance::<T>(n);

        for kernel in plan.kernels.iter().copied() {
            for (thread_count, knob) in plan.cells(kernel, precision, n) {
                progress.set_target(
                    kernel.label(),
                    n,
                    precision.label(),
                    thread_count,
                    kernel.knob().zip(knob),
                );
                let samples = measure(
                    kernel,
                    thread_count,
                    knob,
                    plan.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                progress.step();

                // Checked after timing, against the last timed run's output.
                let error = max_relative_error(&output, &reference);
                if error > tolerance {
                    let knob_text = kernel
                        .knob()
                        .zip(knob)
                        .map_or_else(String::new, |(k, v)| format!(", {} {v}", k.name()));
                    return Err(format!(
                        "{} produced wrong output at n={n}, precision {}, threads {thread_count}{knob_text}: \
                         max relative error {error:e} exceeds tolerance {tolerance:e}",
                        kernel.label(),
                        precision.label(),
                    )
                    .into());
                }

                let stats = summarize(&samples.timed);
                let gpu_ms = samples.gpu.as_deref().map(|gpu| summarize(gpu).median_ms);
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    backend: kernel.backend(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gops: 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9,
                    mean_rel_error_f64: mean_relative_error(&output, &truth),
                    median_ms: stats.median_ms,
                    min_ms: stats.min_ms,
                    stddev_ms: stats.stddev_ms,
                    gpu_ms,
                    setup_ms: samples.setup.as_secs_f64() * 1_000.0,
                    params: samples.params,
                });
            }
        }
    }

    Ok(())
}

fn benchmark_inputs<T: Element>(n: usize) -> (Matrix<T>, Matrix<T>) {
    let lhs = Matrix::from_fn(n, n, |row, col| {
        T::from_ratio((row * 17 + col * 13) % 23, 23)
    });
    let rhs = Matrix::from_fn(n, n, |row, col| {
        T::from_ratio((row * 7 + col * 19) % 29, 29)
    });
    (lhs, rhs)
}

/// One configuration's measurements. `timed` is what a caller waits for per
/// run: one `compute` call, or a Metal kernel's whole round trip (upload,
/// encode, dispatch, download), with its GPU execution alone in `gpu`.
/// `setup` is the one-time cost of building the kernel, taken once.
struct Samples {
    timed: Vec<Duration>,
    gpu: Option<Vec<Duration>>,
    setup: Duration,
    /// The knob values the kernel reported for this configuration.
    params: Vec<Param>,
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
fn measure<T: Element>(
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

/// Timing summary of one configuration's samples, in milliseconds.
struct TimingStats {
    median_ms: f64,
    min_ms: f64,
    stddev_ms: f64,
}

/// Median, minimum, and sample standard deviation (zero for a single sample).
fn summarize(samples: &[Duration]) -> TimingStats {
    assert!(
        !samples.is_empty(),
        "at least one timing sample is required"
    );
    let mut sorted: Vec<f64> = samples.iter().map(|d| d.as_secs_f64() * 1_000.0).collect();
    sorted.sort_by(f64::total_cmp);

    let len = sorted.len();
    let median_ms = if len % 2 == 1 {
        sorted[len / 2]
    } else {
        (sorted[len / 2 - 1] + sorted[len / 2]) / 2.0
    };
    let stddev_ms = if len == 1 {
        0.0
    } else {
        let mean = sorted.iter().sum::<f64>() / len as f64;
        let variance = sorted.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (len - 1) as f64;
        variance.sqrt()
    };

    TimingStats {
        median_ms,
        min_ms: sorted[0],
        stddev_ms,
    }
}

/// Largest element-wise `|output - reference| / |reference|`. A NaN anywhere
/// counts as an infinite error so it can never pass a tolerance check.
fn max_relative_error<T: Element>(output: &Matrix<T>, reference: &Matrix<T>) -> f64 {
    output
        .as_slice()
        .iter()
        .zip(reference.as_slice())
        .map(|(&out, &expected)| {
            let (out, expected) = (out.to_f64(), expected.to_f64());
            let error = (out - expected).abs() / expected.abs().max(f64::MIN_POSITIVE);
            if error.is_nan() { f64::INFINITY } else { error }
        })
        .fold(0.0, f64::max)
}

/// The product of the kernel's own inputs, widened to `f64` and multiplied in
/// `f64`: the ground truth for `mean_rel_error_f64`. Input rounding is not
/// counted, so the error is purely the kernel's arithmetic.
fn f64_reference<T: Element>(lhs: &Matrix<T>, rhs: &Matrix<T>) -> Matrix<f64> {
    let widen = |matrix: &Matrix<T>| {
        Matrix::from_vec(
            matrix.rows(),
            matrix.cols(),
            matrix
                .as_slice()
                .iter()
                .map(|&value| value.to_f64())
                .collect(),
        )
    };
    let mut truth = Matrix::zeros(lhs.rows(), rhs.cols());
    IkjGemm.compute(&widen(lhs), &widen(rhs), &mut truth);
    truth
}

/// Mean over every element of `|truth - output| / |truth|`, against the `f64`
/// ground truth. Informational: it is recorded, never checked against a
/// tolerance. A NaN anywhere makes it infinite, so a broken kernel stays
/// visible instead of dropping out of comparisons.
fn mean_relative_error<T: Element>(output: &Matrix<T>, truth: &Matrix<f64>) -> f64 {
    let total: f64 = output
        .as_slice()
        .iter()
        .zip(truth.as_slice())
        .map(|(&out, &expected)| {
            // An exact zero product (e.g. n = 1, where lhs[0][0] is 0) that the
            // kernel also gets right is 0 / tiny = 0, not 0 / 0 = NaN.
            let error = (out.to_f64() - expected).abs() / expected.abs().max(f64::MIN_POSITIVE);
            if error.is_nan() { f64::INFINITY } else { error }
        })
        .sum();
    total / truth.as_slice().len() as f64
}

/// Rounding slack for kernels that sum each element's `n` products in a
/// different order than the reference: those errors random-walk, growing as `sqrt(n)`.
fn tolerance<T: Element>(n: usize) -> f64 {
    4.0 * (n as f64).sqrt() * T::EPSILON
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use clap::{Parser, ValueEnum};
    use gemm_bench::Matrix;

    use gemm_bench::{
        Element, GemmKernel,
        kernels::{IkjGemm, Param, Source},
    };

    use super::{
        BenchmarkRecord, benchmark_inputs, f64_reference, max_relative_error, mean_relative_error,
        measure, run, summarize, tolerance,
    };
    use crate::{
        cli::Cli,
        db,
        kernel::{KernelChoice, Precision},
        validate,
    };

    fn ms(values: &[u64]) -> Vec<Duration> {
        values.iter().map(|&v| Duration::from_millis(v)).collect()
    }

    #[test]
    fn summarize_odd_sample_count_uses_middle_value() {
        let stats = summarize(&ms(&[30, 10, 20]));
        assert_eq!(stats.median_ms, 20.0);
        assert_eq!(stats.min_ms, 10.0);
        assert!((stats.stddev_ms - 10.0).abs() < 1e-9);
    }

    #[test]
    fn summarize_even_sample_count_averages_middle_values() {
        let stats = summarize(&ms(&[40, 10, 20, 30]));
        assert_eq!(stats.median_ms, 25.0);
        assert_eq!(stats.min_ms, 10.0);
    }

    #[test]
    fn summarize_single_sample_has_zero_stddev() {
        let stats = summarize(&ms(&[7]));
        assert_eq!(
            (stats.median_ms, stats.min_ms, stats.stddev_ms),
            (7.0, 7.0, 0.0)
        );
    }

    #[test]
    fn identical_outputs_have_zero_error() {
        let reference = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
        assert_eq!(max_relative_error(&reference.clone(), &reference), 0.0);
    }

    #[test]
    fn relative_error_reports_the_worst_element() {
        let reference = Matrix::from_vec(1, 2, vec![100.0_f64, 2.0]);
        let output = Matrix::from_vec(1, 2, vec![101.0_f64, 2.1]);
        assert!((max_relative_error(&output, &reference) - 0.05).abs() < 1e-12);
    }

    #[test]
    fn nan_output_is_an_infinite_error() {
        let reference = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
        let output = Matrix::from_vec(1, 2, vec![f32::NAN, 2.0]);
        assert_eq!(max_relative_error(&output, &reference), f64::INFINITY);
    }

    #[test]
    fn tolerance_scales_with_sqrt_n_and_precision() {
        assert_eq!(tolerance::<f64>(16), 16.0 * f64::EPSILON);
        assert!(tolerance::<f16>(4096) > tolerance::<f32>(4096));
        assert_eq!(tolerance::<i32>(4096), 0.0);
        assert_eq!(tolerance::<i64>(4096), 0.0);
    }

    #[test]
    fn identical_output_has_zero_mean_error() {
        let truth = Matrix::from_vec(1, 2, vec![1.0_f64, 2.0]);
        let output = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
        assert_eq!(mean_relative_error(&output, &truth), 0.0);
    }

    #[test]
    fn mean_error_averages_over_every_element() {
        let truth = Matrix::from_vec(1, 2, vec![100.0_f64, 2.0]);
        let output = Matrix::from_vec(1, 2, vec![101.0_f32, 2.0]);
        // (0.01 + 0) / 2
        assert!((mean_relative_error(&output, &truth) - 0.005).abs() < 1e-12);
    }

    #[test]
    fn nan_output_is_an_infinite_mean_error() {
        let truth = Matrix::from_vec(1, 2, vec![1.0_f64, 2.0]);
        let output = Matrix::from_vec(1, 2, vec![f32::NAN, 2.0]);
        assert_eq!(mean_relative_error(&output, &truth), f64::INFINITY);
    }

    fn ikj_error_vs_f64<T: gemm_bench::Element>(n: usize) -> f64 {
        let (lhs, rhs) = benchmark_inputs::<T>(n);
        let mut output = Matrix::zeros(n, n);
        IkjGemm.compute(&lhs, &rhs, &mut output);
        mean_relative_error(&output, &f64_reference(&lhs, &rhs))
    }

    #[test]
    fn error_vs_f64_orders_precisions_by_mantissa_width() {
        let n = 64;
        let (f16, f32, f64) = (
            ikj_error_vs_f64::<f16>(n),
            ikj_error_vs_f64::<f32>(n),
            ikj_error_vs_f64::<f64>(n),
        );
        assert!(f16 > f32 && f32 > 0.0, "f16 {f16:e}, f32 {f32:e}");
        // The reference widens the kernel's own inputs, so f64 and exact
        // integer products match it bit for bit.
        assert_eq!(f64, 0.0);
        assert_eq!(ikj_error_vs_f64::<i32>(n), 0.0);
        assert_eq!(ikj_error_vs_f64::<i64>(n), 0.0);
    }

    #[test]
    fn integer_inputs_are_not_truncated_to_zero() {
        let (lhs, rhs) = benchmark_inputs::<i32>(8);
        assert!(lhs.as_slice().iter().any(|&value| value != 0));
        assert!(rhs.as_slice().iter().any(|&value| value != 0));
    }

    #[test]
    fn cpu_kernels_have_a_setup_time_and_no_gpu_window() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::RayonIkj, 2, None, 2, &lhs, &rhs, &mut output)
            .expect("rayon-ikj should run");
        assert_eq!(samples.timed.len(), 2);
        assert!(samples.gpu.is_none());
        // Building a two-worker pool spawns threads, which takes measurable time.
        assert!(samples.setup > Duration::ZERO);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_kernels_time_the_round_trip_the_gpu_window_and_setup() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::Mps, 1, None, 2, &lhs, &rhs, &mut output)
            .expect("mps should run");
        let gpu = samples.gpu.expect("a Metal kernel records its GPU window");
        assert_eq!((samples.timed.len(), gpu.len()), (2, 2));
        // `timed` is the round trip, and the GPU window sits inside it.
        assert!(gpu.iter().zip(&samples.timed).all(|(gpu, e2e)| gpu <= e2e));
        assert!(samples.setup > Duration::ZERO);
    }

    #[test]
    fn a_measurement_carries_the_params_its_kernel_reports() {
        let (lhs, rhs) = benchmark_inputs::<f32>(64);
        let mut output = Matrix::zeros(64, 64);
        let tiled = measure(KernelChoice::Tiled, 1, Some(16), 1, &lhs, &rhs, &mut output)
            .expect("tiled runs");
        assert_eq!(tiled.params, [Param::swept("tile_size", 16)]);
        // Asked inside its own 2-worker pool: 8 tasks of 8 rows. Asked on
        // the global pool it would plan 4 tasks per core of this machine.
        let rayon = measure(
            KernelChoice::RayonTiled,
            2,
            Some(16),
            1,
            &lhs,
            &rhs,
            &mut output,
        )
        .expect("rayon-tiled runs");
        assert!(
            rayon.params.contains(&Param::derived("tasks", 8)),
            "{:?}",
            rayon.params
        );
        assert!(rayon.params.contains(&Param::derived("rows_per_task", 8)));
        let ikj =
            measure(KernelChoice::Ikj, 1, None, 1, &lhs, &rhs, &mut output).expect("ikj runs");
        assert!(ikj.params.is_empty());
    }

    /// One real run of `kernel` at n = 8, planned, written and validated as
    /// `main` and CI do: this machine's real capture, through `write_run`
    /// and `validate` (on CI, the Linux capture path).
    fn run_one(kernel: &str) -> Vec<BenchmarkRecord> {
        let root = std::env::temp_dir().join(format!(
            "gemm-bench-run-test-{}-{kernel}",
            std::process::id()
        ));
        let output = root.join("data/db/test/run.sqlite");
        let mut plan = Cli::try_parse_from([
            "gemm-bench",
            "--output",
            output.to_str().expect("temp paths are UTF-8"),
            "--sizes",
            "8",
            "--kernel",
            kernel,
            "--threads",
            "1",
            "--precision",
            "f32",
            "--repetitions",
            "2",
            "--no-progress",
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("the plan should be valid");
        let records = run(&plan).expect("the run should succeed");
        db::write_run(
            &mut plan.db,
            &plan.context,
            plan.repetitions,
            &plan.machine,
            &records,
        )
        .expect("the run should be written");
        let verdict = validate::validate(&output);
        let _ = std::fs::remove_dir_all(root);
        verdict.expect("the written DB should pass validate");
        records
    }

    #[test]
    fn a_cpu_measurement_writes_one_record_without_gpu_ms() {
        let records = run_one("ikj");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].kernel, "ikj");
        assert_eq!(records[0].gpu_ms, None);
        assert!(records[0].setup_ms >= 0.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_metal_measurement_writes_one_end_to_end_record_with_gpu_ms() {
        let records = run_one("mps");
        assert_eq!(records.len(), 1, "no separate -e2e record");
        let record = &records[0];
        assert_eq!(record.kernel, "mps");
        let gpu_ms = record.gpu_ms.expect("Metal records carry gpu_ms");
        // Each GPU window sits inside its round trip, so the medians keep that order.
        assert!(gpu_ms <= record.median_ms);
        // gops comes from the round trip, like every CPU row.
        let expected = 2.0 * 8f64.powi(3) / (record.median_ms / 1_000.0) / 1e9;
        assert!((record.gops - expected).abs() <= 1e-9 * expected);
        assert!(record.setup_ms > 0.0);
    }

    /// The params one real measurement of `kernel` reports, at 2 threads and
    /// its knob's smallest default value.
    fn params_at(kernel: KernelChoice, precision: Precision, n: usize) -> Vec<Param> {
        fn at<T: Element>(kernel: KernelChoice, n: usize) -> Vec<Param> {
            let (lhs, rhs) = benchmark_inputs::<T>(n);
            let mut output = Matrix::zeros(n, n);
            let knob = kernel.knob().map(|knob| knob.defaults()[0]);
            measure(kernel, 2, knob, 1, &lhs, &rhs, &mut output)
                .expect("the kernel should run")
                .params
        }
        match precision {
            Precision::F16 => at::<f16>(kernel, n),
            Precision::F32 => at::<f32>(kernel, n),
            Precision::F64 => at::<f64>(kernel, n),
            Precision::I32 => at::<i32>(kernel, n),
            Precision::I64 => at::<i64>(kernel, n),
        }
    }

    /// `validate` trusts `declared_params` for DBs it never saw being written,
    /// so every kernel must report exactly what it declares.
    #[test]
    fn every_kernel_records_exactly_the_params_it_declares() {
        for &kernel in KernelChoice::value_variants() {
            #[cfg(target_os = "macos")]
            if kernel == KernelChoice::AccelerateBnns
                && (gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_none()
                    || std::env::var_os("CI").is_some()
                    || std::env::var_os("GEMM_BENCH_DISABLE_AMX").is_some())
            {
                continue; // needs macOS 26 / disabled in CI
            }
            for &precision in Precision::value_variants() {
                if !kernel.supports(precision) {
                    continue;
                }
                for n in [8, 33] {
                    let mut recorded: Vec<(&str, Source)> = params_at(kernel, precision, n)
                        .iter()
                        .map(|p| (p.name, p.source))
                        .collect();
                    recorded.sort_unstable_by_key(|&(name, _)| name);
                    assert_eq!(
                        recorded,
                        kernel.declared_params(),
                        "{} at {} with n = {n}",
                        kernel.label(),
                        precision.label()
                    );
                }
            }
        }
    }
}

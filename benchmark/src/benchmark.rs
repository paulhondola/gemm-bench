use std::{
    hint::black_box,
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
use gemm_bench::kernels::{AccelerateBlasGemm, AccelerateBnnsGemm, MpsGemm};
use gemm_bench::{
    Element, GemmKernel, Matrix,
    kernels::{
        IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm, StaticTiledGemm, TiledGemm,
    },
};
use rayon::{ThreadPool, ThreadPoolBuilder};
use serde::Serialize;

use crate::{
    kernel::{KernelChoice, Precision},
    plan::BenchmarkPlan,
    report::BenchmarkProgress,
};

/// One measured benchmark configuration, shared by terminal and file reporters.
/// Field order is the CSV column order.
#[derive(Debug, Serialize)]
pub(crate) struct BenchmarkRecord {
    pub(crate) kernel: String,
    pub(crate) backend: &'static str,
    pub(crate) device: String,
    pub(crate) precision: &'static str,
    pub(crate) n: usize,
    pub(crate) threads: usize,
    pub(crate) gops: f64,
    pub(crate) mean_rel_error_f64: f64,
    pub(crate) median_ms: f64,
    pub(crate) min_ms: f64,
    pub(crate) stddev_ms: f64,
    /// Empty in the CSV for kernels that don't tile.
    pub(crate) block_size: Option<usize>,
    pub(crate) repetitions: usize,
    pub(crate) host: String,
    pub(crate) commit: String,
    pub(crate) timestamp: String,
}

pub(crate) fn run(
    plan: &BenchmarkPlan,
) -> Result<Vec<BenchmarkRecord>, Box<dyn std::error::Error>> {
    let mut records = Vec::new();
    let progress = BenchmarkProgress::new(plan.total_configurations(), plan.no_progress);

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
            for (thread_count, block_size) in plan.cells(kernel, precision, n) {
                progress.set_target(
                    kernel.label(),
                    n,
                    precision.label(),
                    thread_count,
                    block_size,
                );
                let samples = measure(
                    kernel,
                    thread_count,
                    block_size,
                    plan.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                progress.step();

                // Checked after timing, against the last timed run's output.
                let error = max_relative_error(&output, &reference);
                if error > tolerance {
                    let block =
                        block_size.map_or_else(String::new, |b| format!(", block size {b}"));
                    return Err(format!(
                        "{} produced wrong output at n={n}, precision {}, threads {thread_count}{block}: \
                         max relative error {error:e} exceeds tolerance {tolerance:e}",
                        kernel.label(),
                        precision.label(),
                    )
                    .into());
                }

                let stats = summarize(&samples);
                let gops = 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9;
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    backend: kernel.backend(),
                    device: plan.devices.of(kernel).to_owned(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gops,
                    mean_rel_error_f64: mean_relative_error(&output, &truth),
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

/// Returns the durations of `repetitions` timed runs.
///
/// Kernel setup (a pool, a compiled graph, a Metal queue) happens here,
/// before `sample`'s untimed warm-up run, so one-time costs (the process's
/// first Rayon call, a fresh pool's idle workers) stay out of the samples.
fn measure<T: Element>(
    choice: KernelChoice,
    threads: usize,
    block_size: Option<usize>,
    repetitions: usize,
    lhs: &Matrix<T>,
    rhs: &Matrix<T>,
    output: &mut Matrix<T>,
) -> Result<Vec<Duration>, rayon::ThreadPoolBuildError> {
    // `BenchmarkPlan::cells` gives every tiled kernel a block size.
    let block = || block_size.expect("tiled kernels always get a block size");
    let io = (lhs, rhs, output, repetitions);
    Ok(match choice {
        KernelChoice::Naive => sample(&NaiveGemm, io),
        KernelChoice::Ikj => sample(&IkjGemm, io),
        KernelChoice::Tiled => sample(&TiledGemm::new(block()), io),
        KernelChoice::RayonIkj => sample(&InPool::new(threads, RayonIkjGemm)?, io),
        KernelChoice::RayonTiled => {
            sample(&InPool::new(threads, RayonTiledGemm::new(block()))?, io)
        }
        KernelChoice::StaticIkj => sample(&StaticIkjGemm::new(threads)?, io),
        KernelChoice::StaticTiled => sample(&StaticTiledGemm::new(threads, block())?, io),
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBlas => sample(&AccelerateBlasGemm, io),
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBnns => sample(
            &AccelerateBnnsGemm::<T>::new(lhs.rows())
                .expect("accelerate-bnns needs macOS 26 (the BNNSGraph builder)"),
            io,
        ),
        // MPS times only the GPU dispatch, so it runs its own loop.
        #[cfg(target_os = "macos")]
        KernelChoice::Mps => MpsGemm::<T>::new()
            .expect("MPS needs a Metal device and f16 or f32")
            .benchmark(lhs, rhs, io.2, repetitions),
    })
}

/// One untimed warm-up run, then `repetitions` timed ones.
fn sample<T: Element>(
    kernel: &impl GemmKernel<T>,
    (lhs, rhs, output, repetitions): (&Matrix<T>, &Matrix<T>, &mut Matrix<T>, usize),
) -> Vec<Duration> {
    kernel.compute(lhs, rhs, output);
    (0..repetitions)
        .map(|_| time_kernel(kernel, lhs, rhs, output))
        .collect()
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

    use gemm_bench::Matrix;

    use gemm_bench::{GemmKernel, kernels::IkjGemm};

    use super::{
        benchmark_inputs, f64_reference, max_relative_error, mean_relative_error, summarize,
        tolerance,
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
}

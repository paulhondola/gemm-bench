use std::{
    hint::black_box,
    time::{Duration, Instant},
};

use rayon::ThreadPoolBuilder;
use rayon_gemm::{
    GemmKernel, Matrix,
    kernels::{IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm, TiledGemm},
};
use serde::Serialize;

use crate::cli::{BenchmarkPlan, KernelChoice};

/// One measured benchmark configuration, shared by terminal and file reporters.
#[derive(Debug, Serialize)]
pub(crate) struct BenchmarkRecord {
    pub(crate) kernel: String,
    pub(crate) n: usize,
    pub(crate) threads: usize,
    pub(crate) elapsed_ms: f64,
    pub(crate) gflops: f64,
}

pub(crate) fn run(
    plan: &BenchmarkPlan,
) -> Result<Vec<BenchmarkRecord>, rayon::ThreadPoolBuildError> {
    let mut records = Vec::new();

    for &n in &plan.sizes {
        let (lhs, rhs) = benchmark_inputs(n);
        let mut output = Matrix::zeros(n, n);

        for kernel in plan.kernels.iter().copied() {
            let thread_counts: &[usize] = if kernel.uses_workers() {
                &plan.threads
            } else {
                &[1]
            };
            for &thread_count in thread_counts {
                let elapsed = measure(
                    kernel,
                    thread_count,
                    plan.block_size,
                    plan.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                let elapsed_ms = elapsed.as_secs_f64() * 1_000.0;
                let gflops = 2.0 * (n as f64).powi(3) / elapsed.as_secs_f64() / 1e9;
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    n,
                    threads: thread_count,
                    elapsed_ms,
                    gflops,
                });
            }
        }
    }

    Ok(records)
}

fn benchmark_inputs(n: usize) -> (Matrix<f64>, Matrix<f64>) {
    let lhs = Matrix::from_fn(n, n, |row, col| ((row * 17 + col * 13) % 23) as f64 / 23.0);
    let rhs = Matrix::from_fn(n, n, |row, col| ((row * 7 + col * 19) % 29) as f64 / 29.0);
    (lhs, rhs)
}

fn measure(
    choice: KernelChoice,
    threads: usize,
    block_size: usize,
    repetitions: usize,
    lhs: &Matrix<f64>,
    rhs: &Matrix<f64>,
    output: &mut Matrix<f64>,
) -> Result<Duration, rayon::ThreadPoolBuildError> {
    let mut total = Duration::ZERO;
    match choice {
        KernelChoice::Naive => {
            let kernel = NaiveGemm;
            for _ in 0..repetitions {
                total += time_kernel(&kernel, lhs, rhs, output);
            }
        }
        KernelChoice::Ikj => {
            let kernel = IkjGemm;
            for _ in 0..repetitions {
                total += time_kernel(&kernel, lhs, rhs, output);
            }
        }
        KernelChoice::Tiled => {
            let kernel = TiledGemm::new(block_size);
            for _ in 0..repetitions {
                total += time_kernel(&kernel, lhs, rhs, output);
            }
        }
        KernelChoice::RayonIkj => {
            let pool = ThreadPoolBuilder::new().num_threads(threads).build()?;
            let kernel = RayonIkjGemm;
            for _ in 0..repetitions {
                let start = Instant::now();
                pool.install(|| kernel.compute(black_box(lhs), black_box(rhs), black_box(output)));
                black_box(output.as_slice());
                total += start.elapsed();
            }
        }
        KernelChoice::RayonTiled => {
            let pool = ThreadPoolBuilder::new().num_threads(threads).build()?;
            let kernel = RayonTiledGemm::new(block_size);
            for _ in 0..repetitions {
                let start = Instant::now();
                pool.install(|| kernel.compute(black_box(lhs), black_box(rhs), black_box(output)));
                black_box(output.as_slice());
                total += start.elapsed();
            }
        }
        KernelChoice::StaticIkj => {
            let kernel = StaticIkjGemm::new(threads);
            for _ in 0..repetitions {
                total += time_kernel(&kernel, lhs, rhs, output);
            }
        }
    }

    Ok(total.div_f64(repetitions as f64))
}

fn time_kernel(
    kernel: &impl GemmKernel,
    lhs: &Matrix<f64>,
    rhs: &Matrix<f64>,
    output: &mut Matrix<f64>,
) -> Duration {
    let start = Instant::now();
    kernel.compute(black_box(lhs), black_box(rhs), black_box(output));
    black_box(output.as_slice());
    start.elapsed()
}

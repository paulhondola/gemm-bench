use std::{
    fs::File,
    hint::black_box,
    path::PathBuf,
    time::{Duration, Instant},
};

use clap::{Parser, ValueEnum};
use rayon::ThreadPoolBuilder;
use rayon_gemm::{
    GemmKernel, Matrix,
    kernels::{IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm, TiledGemm},
};
use serde::Serialize;

const DEFAULT_SIZES: [usize; 6] = [64, 128, 256, 512, 1024, 2048];

#[derive(Debug, Parser)]
#[command(about = "Benchmark safe, row-major f64 GEMM kernels")]
struct Cli {
    /// Matrix dimensions, as a comma-delimited list.
    #[arg(long, value_delimiter = ',')]
    sizes: Vec<usize>,

    /// Worker counts, as a comma-delimited list. Defaults to powers of two up to available CPUs.
    #[arg(long, value_delimiter = ',')]
    threads: Vec<usize>,

    /// Kernel(s) to run. Omit to run every kernel.
    #[arg(long, value_delimiter = ',', value_enum)]
    kernel: Vec<KernelChoice>,

    /// Number of measured runs per configuration; the CSV contains their mean.
    #[arg(long, default_value_t = 1)]
    repetitions: usize,

    /// Tile edge length for the blocked kernels.
    #[arg(long, default_value_t = 64)]
    block_size: usize,

    /// Destination for the structured benchmark records.
    #[arg(long)]
    output: PathBuf,

    /// Serialization format for --output.
    #[arg(long, value_enum, default_value_t = OutputFormat::Csv)]
    format: OutputFormat,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum KernelChoice {
    Naive,
    Ikj,
    Tiled,
    RayonIkj,
    RayonTiled,
    StaticIkj,
}

impl KernelChoice {
    fn label(self) -> &'static str {
        match self {
            Self::Naive => "naive-ijk",
            Self::Ikj => "ikj",
            Self::Tiled => "tiled",
            Self::RayonIkj => "rayon-ikj",
            Self::RayonTiled => "rayon-tiled",
            Self::StaticIkj => "static-ikj",
        }
    }

    fn uses_workers(self) -> bool {
        matches!(self, Self::RayonIkj | Self::RayonTiled | Self::StaticIkj)
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OutputFormat {
    Csv,
    Json,
}

#[derive(Debug, Serialize)]
struct BenchmarkRecord {
    kernel: String,
    n: usize,
    threads: usize,
    elapsed_ms: f64,
    gflops: f64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    validate_cli(&cli)?;

    let sizes = if cli.sizes.is_empty() {
        DEFAULT_SIZES.to_vec()
    } else {
        cli.sizes.clone()
    };
    let threads = if cli.threads.is_empty() {
        default_thread_counts()
    } else {
        cli.threads.clone()
    };
    let kernels = if cli.kernel.is_empty() {
        vec![
            KernelChoice::Naive,
            KernelChoice::Ikj,
            KernelChoice::Tiled,
            KernelChoice::RayonIkj,
            KernelChoice::RayonTiled,
            KernelChoice::StaticIkj,
        ]
    } else {
        cli.kernel.clone()
    };

    println!("kernel          n  threads   elapsed_ms    gflops");
    let mut records = Vec::new();
    for n in sizes {
        let (lhs, rhs) = benchmark_inputs(n);
        let mut output = Matrix::zeros(n, n);

        for kernel in kernels.iter().copied() {
            let thread_counts: &[usize] = if kernel.uses_workers() {
                &threads
            } else {
                &[1]
            };
            for &thread_count in thread_counts {
                let elapsed = measure(
                    kernel,
                    thread_count,
                    cli.block_size,
                    cli.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                let elapsed_ms = elapsed.as_secs_f64() * 1_000.0;
                let gflops = 2.0 * (n as f64).powi(3) / elapsed.as_secs_f64() / 1e9;
                let record = BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    n,
                    threads: thread_count,
                    elapsed_ms,
                    gflops,
                };
                println!(
                    "{:<14} {:>5} {:>8} {:>12.3} {:>9.3}",
                    record.kernel, record.n, record.threads, record.elapsed_ms, record.gflops
                );
                records.push(record);
            }
        }
    }

    write_records(&cli.output, cli.format, &records)?;
    Ok(())
}

fn validate_cli(cli: &Cli) -> Result<(), String> {
    if cli.repetitions == 0 {
        return Err("--repetitions must be greater than zero".into());
    }
    if cli.block_size == 0 {
        return Err("--block-size must be greater than zero".into());
    }
    if cli.sizes.contains(&0) {
        return Err("all --sizes values must be greater than zero".into());
    }
    if cli.threads.contains(&0) {
        return Err("all --threads values must be greater than zero".into());
    }
    Ok(())
}

fn default_thread_counts() -> Vec<usize> {
    let max = std::thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(1);
    let mut counts = Vec::new();
    let mut current = 1;
    while current < max {
        counts.push(current);
        current *= 2;
    }
    counts.push(max);
    counts
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

fn write_records(
    path: &PathBuf,
    format: OutputFormat,
    records: &[BenchmarkRecord],
) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::create(path)?;
    match format {
        OutputFormat::Csv => {
            let mut writer = csv::Writer::from_writer(file);
            for record in records {
                writer.serialize(record)?;
            }
            writer.flush()?;
        }
        OutputFormat::Json => serde_json::to_writer_pretty(file, records)?,
    }
    Ok(())
}

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

use clap::{Parser, ValueEnum};

const DEFAULT_SIZES: [usize; 6] = [64, 128, 256, 512, 1024, 2048];

#[derive(Debug, Parser)]
#[command(about = "Benchmark safe, row-major f64 GEMM kernels")]
pub(crate) struct Cli {
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

    /// Destination for structured records. Use a .csv or .json extension.
    #[arg(long)]
    output: PathBuf,
}

/// Fully resolved configuration used by the benchmark runner.
#[derive(Debug)]
pub(crate) struct BenchmarkPlan {
    pub(crate) sizes: Vec<usize>,
    pub(crate) threads: Vec<usize>,
    pub(crate) kernels: Vec<KernelChoice>,
    pub(crate) repetitions: usize,
    pub(crate) block_size: usize,
    pub(crate) output: PathBuf,
    pub(crate) format: OutputFormat,
}

impl Cli {
    pub(crate) fn into_plan(self) -> Result<BenchmarkPlan, String> {
        validate_cli(&self)?;
        let format = infer_output_format(&self.output)?;

        let sizes = if self.sizes.is_empty() {
            DEFAULT_SIZES.to_vec()
        } else {
            self.sizes
        };
        let threads = if self.threads.is_empty() {
            default_thread_counts()
        } else {
            self.threads
        };
        let kernels = if self.kernel.is_empty() {
            vec![
                KernelChoice::Naive,
                KernelChoice::Ikj,
                KernelChoice::Tiled,
                KernelChoice::RayonIkj,
                KernelChoice::RayonTiled,
                KernelChoice::StaticIkj,
            ]
        } else {
            self.kernel
        };

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            repetitions: self.repetitions,
            block_size: self.block_size,
            output: self.output,
            format,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputFormat {
    Csv,
    Json,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum KernelChoice {
    Naive,
    Ikj,
    Tiled,
    RayonIkj,
    RayonTiled,
    StaticIkj,
}

impl KernelChoice {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Naive => "naive-ijk",
            Self::Ikj => "ikj",
            Self::Tiled => "tiled",
            Self::RayonIkj => "rayon-ikj",
            Self::RayonTiled => "rayon-tiled",
            Self::StaticIkj => "static-ikj",
        }
    }

    pub(crate) fn uses_workers(self) -> bool {
        matches!(self, Self::RayonIkj | Self::RayonTiled | Self::StaticIkj)
    }
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

fn infer_output_format(path: &Path) -> Result<OutputFormat, String> {
    match path.extension().and_then(OsStr::to_str) {
        Some(extension) if extension.eq_ignore_ascii_case("csv") => Ok(OutputFormat::Csv),
        Some(extension) if extension.eq_ignore_ascii_case("json") => Ok(OutputFormat::Json),
        _ => Err(format!(
            "unsupported output path '{}'; use a .csv or .json extension",
            path.display()
        )),
    }
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{Cli, KernelChoice, OutputFormat, infer_output_format};

    #[test]
    fn empty_sweeps_expand_to_defaults() {
        let plan = Cli {
            sizes: Vec::new(),
            threads: Vec::new(),
            kernel: Vec::new(),
            repetitions: 1,
            block_size: 64,
            output: PathBuf::from("results.csv"),
        }
        .into_plan()
        .expect("default plan should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels.first(), Some(&KernelChoice::Naive));
        assert_eq!(plan.kernels.last(), Some(&KernelChoice::StaticIkj));
        assert_eq!(plan.format, OutputFormat::Csv);
    }

    #[test]
    fn output_format_is_inferred_from_a_supported_extension() {
        assert_eq!(
            infer_output_format(PathBuf::from("results.CSV").as_path())
                .expect("CSV should be supported"),
            OutputFormat::Csv
        );
        assert_eq!(
            infer_output_format(PathBuf::from("results.json").as_path())
                .expect("JSON should be supported"),
            OutputFormat::Json
        );
    }

    #[test]
    fn unsupported_output_extensions_are_rejected_before_running() {
        let error = infer_output_format(PathBuf::from("results.toml").as_path())
            .expect_err("unsupported extension must be rejected");

        assert!(error.contains(".csv or .json"));
    }
}

use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};

use clap::{Parser, ValueEnum};

const DEFAULT_SIZES: [usize; 6] = [64, 128, 256, 512, 1024, 2048];

#[derive(Debug, Parser)]
#[command(about = "Benchmark safe, row-major floating-point GEMM kernels")]
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

    /// Element precision(s), as a comma-delimited list. Defaults to f32.
    #[arg(long, value_delimiter = ',', value_enum)]
    precision: Vec<Precision>,

    /// Number of measured runs per configuration, after one untimed warm-up
    /// run; records contain their mean.
    #[arg(long, default_value_t = 1)]
    repetitions: usize,

    /// Tile edge length for the blocked kernels.
    #[arg(long, default_value_t = 64)]
    block_size: usize,

    /// Destination for structured records. Use a .csv or .json extension;
    /// missing parent directories are created.
    #[arg(long)]
    output: PathBuf,
}

/// Fully resolved configuration used by the benchmark runner.
#[derive(Debug)]
pub(crate) struct BenchmarkPlan {
    pub(crate) sizes: Vec<usize>,
    pub(crate) threads: Vec<usize>,
    pub(crate) kernels: Vec<KernelChoice>,
    pub(crate) precisions: Vec<Precision>,
    pub(crate) repetitions: usize,
    pub(crate) block_size: usize,
    pub(crate) output: File,
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
        let precisions = if self.precision.is_empty() {
            vec![Precision::F32]
        } else {
            self.precision
        };

        // Validate the resolved sweep before touching the filesystem, so a
        // rejected plan never creates directories or an output file.
        validate_static_threads(&kernels, &threads, &sizes)?;
        let output = open_output(&self.output)?;

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            precisions,
            repetitions: self.repetitions,
            block_size: self.block_size,
            output,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum Precision {
    F16,
    F32,
    F64,
}

impl Precision {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::F16 => "f16",
            Self::F32 => "f32",
            Self::F64 => "f64",
        }
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

/// `static-ikj` gives every worker at least one row, so a worker count above
/// the smallest matrix dimension cannot be honored and is rejected up front.
fn validate_static_threads(
    kernels: &[KernelChoice],
    threads: &[usize],
    sizes: &[usize],
) -> Result<(), String> {
    if !kernels.contains(&KernelChoice::StaticIkj) {
        return Ok(());
    }
    let max_threads = threads.iter().copied().max().unwrap_or(1);
    let min_size = sizes.iter().copied().min().unwrap_or(usize::MAX);
    if max_threads > min_size {
        return Err(format!(
            "static-ikj needs at least one row per thread; --threads {max_threads} exceeds --sizes {min_size}"
        ));
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

/// Creates missing parent directories and opens the output file before any
/// benchmark runs, so an unwritable path fails immediately instead of after
/// the sweep. The file is not truncated here: an existing result file keeps
/// its contents until the new records are written.
fn open_output(path: &Path) -> Result<File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "cannot create output directory '{}': {error}",
                parent.display()
            )
        })?;
    }

    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|error| format!("cannot open output file '{}': {error}", path.display()))
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
    use std::{ffi::OsStr, fs, path::PathBuf};

    use clap::Parser;

    use super::{Cli, KernelChoice, OutputFormat, Precision, infer_output_format, open_output};

    /// A per-process path under the system temp directory, so tests never
    /// write into the repository and parallel test runs do not collide.
    fn temp_output(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rayon-gemm-test-{}-{name}", std::process::id()))
    }

    #[test]
    fn empty_sweeps_expand_to_defaults() {
        let output = temp_output("defaults.csv");
        let plan = Cli {
            sizes: Vec::new(),
            threads: Vec::new(),
            kernel: Vec::new(),
            precision: Vec::new(),
            repetitions: 1,
            block_size: 64,
            output: output.clone(),
        }
        .into_plan()
        .expect("default plan should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels.first(), Some(&KernelChoice::Naive));
        assert_eq!(plan.kernels.last(), Some(&KernelChoice::StaticIkj));
        assert_eq!(plan.precisions, [Precision::F32]);
        assert_eq!(plan.format, OutputFormat::Csv);
        fs::remove_file(output).expect("remove test output");
    }

    #[test]
    fn precision_flag_accepts_a_comma_delimited_sweep() {
        let output = temp_output("precision.csv");
        let plan = Cli::try_parse_from([
            OsStr::new("rayon-gemm"),
            OsStr::new("--precision"),
            OsStr::new("f16,f64"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("precision list should parse")
        .into_plan()
        .expect("plan should be valid");

        assert_eq!(plan.precisions, [Precision::F16, Precision::F64]);
        fs::remove_file(output).expect("remove test output");
    }

    #[test]
    fn static_threads_above_the_matrix_dimension_are_rejected_before_running() {
        let output = temp_output("static-threads.csv");
        let error = Cli::try_parse_from([
            OsStr::new("rayon-gemm"),
            OsStr::new("--sizes"),
            OsStr::new("8,64"),
            OsStr::new("--threads"),
            OsStr::new("4,16"),
            OsStr::new("--kernel"),
            OsStr::new("static-ikj"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("more static threads than rows must be rejected");

        assert!(error.contains("--threads 16 exceeds --sizes 8"));
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
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

    #[test]
    fn missing_output_directories_are_created_before_running() {
        let root = temp_output("nested");
        let output = root.join("a/b/results.csv");

        open_output(&output).expect("missing parent directories should be created");

        assert!(output.is_file());
        fs::remove_dir_all(root).expect("remove test directories");
    }

    #[test]
    fn unusable_output_paths_are_rejected_before_running() {
        let blocker = temp_output("blocker");
        fs::write(&blocker, b"").expect("create a regular file");

        let error = open_output(&blocker.join("results.csv"))
            .expect_err("a regular file cannot be a parent directory");

        assert!(error.contains("output directory"));
        fs::remove_file(blocker).expect("remove test file");
    }

    #[test]
    fn existing_output_is_not_truncated_until_records_are_written() {
        let output = temp_output("existing.csv");
        fs::write(&output, b"previous results").expect("seed an existing output");

        open_output(&output).expect("existing output should open");

        assert_eq!(
            fs::read(&output).expect("read existing output"),
            b"previous results"
        );
        fs::remove_file(output).expect("remove test output");
    }
}

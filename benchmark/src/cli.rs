use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};

use clap::{Parser, ValueEnum};

use crate::context::{self, RunContext};

const DEFAULT_SIZES: [usize; 7] = [64, 128, 256, 512, 1024, 2048, 4096];

#[derive(Debug, Parser)]
#[command(about = "Benchmark safe, row-major GEMM kernels")]
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
    /// run; records contain their median, minimum, and standard deviation.
    #[arg(long, default_value_t = 5)]
    repetitions: usize,

    /// Tile edge length(s) for the tiled kernels, as a comma-delimited list.
    #[arg(long, value_delimiter = ',', default_values_t = [64])]
    block_size: Vec<usize>,

    /// Output CSV file. Defaults to a new file per run,
    /// data/runs/<host>/<timestamp>.csv; missing parent directories are created.
    #[arg(long)]
    output: Option<PathBuf>,

    /// Disable the interactive progress bar.
    #[arg(long)]
    no_progress: bool,
}

/// Fully resolved configuration used by the benchmark runner.
#[derive(Debug)]
pub(crate) struct BenchmarkPlan {
    pub(crate) sizes: Vec<usize>,
    pub(crate) threads: Vec<usize>,
    pub(crate) kernels: Vec<KernelChoice>,
    pub(crate) precisions: Vec<Precision>,
    pub(crate) repetitions: usize,
    pub(crate) block_sizes: Vec<usize>,
    pub(crate) context: RunContext,
    pub(crate) devices: Devices,
    pub(crate) output: File,
    pub(crate) output_path: PathBuf,
    pub(crate) no_progress: bool,
}

impl BenchmarkPlan {
    /// The (threads, block size) cells measured for one kernel. The single
    /// source for the sweep loop and the configuration count.
    pub(crate) fn cells(&self, kernel: KernelChoice) -> Vec<(usize, Option<usize>)> {
        let threads: &[usize] = if kernel.uses_workers() {
            &self.threads
        } else {
            &[1]
        };
        let blocks: Vec<Option<usize>> = if kernel.uses_blocks() {
            self.block_sizes.iter().copied().map(Some).collect()
        } else {
            vec![None]
        };
        threads
            .iter()
            .flat_map(|&t| blocks.iter().map(move |&b| (t, b)))
            .collect()
    }

    /// Returns the exact number of configurations that will be measured.
    pub(crate) fn total_configurations(&self) -> usize {
        let per_matrix: usize = self.kernels.iter().map(|&k| self.cells(k).len()).sum();
        self.precisions.len() * self.sizes.len() * per_matrix
    }
}

/// Device names, looked up once per backend before any kernel runs.
#[derive(Debug)]
pub(crate) struct Devices {
    pub(crate) cpu: String,
    #[cfg(target_os = "macos")]
    pub(crate) metal: String,
}

impl Devices {
    // Off macOS only the CPU is looked up, leaving `kernels` unread.
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    fn lookup(kernels: &[KernelChoice]) -> Self {
        Self {
            cpu: context::cpu_name(),
            #[cfg(target_os = "macos")]
            metal: kernels
                .contains(&KernelChoice::Mps)
                .then(gemm_bench::kernels::mps::default_device_name)
                .flatten()
                .unwrap_or_else(|| context::UNKNOWN.to_owned()),
        }
    }
}

impl Cli {
    pub(crate) fn into_plan(self) -> Result<BenchmarkPlan, String> {
        validate_cli(&self)?;

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
        let precisions = if self.precision.is_empty() {
            vec![Precision::F32]
        } else {
            self.precision
        };
        let kernels = if self.kernel.is_empty() {
            // Defaults run only kernels that support every requested precision.
            KernelChoice::value_variants()
                .iter()
                .copied()
                .filter(|kernel| precisions.iter().all(|&p| kernel.supports(p)))
                .collect()
        } else {
            self.kernel
        };

        // Validate the resolved sweep before touching the filesystem, so a
        // rejected plan never creates directories or an output file.
        validate_static_threads(&kernels, &threads, &sizes)?;
        validate_precisions(&kernels, &precisions)?;
        let context = context::capture();
        let devices = Devices::lookup(&kernels);
        let output_path = self
            .output
            .unwrap_or_else(|| default_output_path(&context.host, &context.file_stamp));
        let output = open_output(&output_path)?;

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            precisions,
            repetitions: self.repetitions,
            block_sizes: self.block_size,
            context,
            devices,
            output,
            output_path,
            no_progress: self.no_progress,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum KernelChoice {
    Naive,
    Ikj,
    Tiled,
    RayonIkj,
    RayonTiled,
    StaticIkj,
    StaticTiled,
    #[cfg(target_os = "macos")]
    #[value(name = "mps")]
    Mps,
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
            Self::StaticTiled => "static-tiled",
            #[cfg(target_os = "macos")]
            Self::Mps => "mps",
        }
    }

    /// Hardware family the kernel runs on. Needed next to `device` because
    /// Apple Silicon reports the same name for its CPU and GPU.
    pub(crate) fn backend(self) -> &'static str {
        match self {
            Self::Naive
            | Self::Ikj
            | Self::Tiled
            | Self::RayonIkj
            | Self::RayonTiled
            | Self::StaticIkj
            | Self::StaticTiled => "cpu",
            #[cfg(target_os = "macos")]
            Self::Mps => "metal",
        }
    }

    pub(crate) fn device(self, devices: &Devices) -> &str {
        match self {
            Self::Naive
            | Self::Ikj
            | Self::Tiled
            | Self::RayonIkj
            | Self::RayonTiled
            | Self::StaticIkj
            | Self::StaticTiled => &devices.cpu,
            #[cfg(target_os = "macos")]
            Self::Mps => &devices.metal,
        }
    }

    pub(crate) fn uses_workers(self) -> bool {
        matches!(
            self,
            Self::RayonIkj | Self::RayonTiled | Self::StaticIkj | Self::StaticTiled
        )
    }

    /// Whether the kernel tiles by `--block-size`; the others run once and
    /// record an empty block size.
    pub(crate) fn uses_blocks(self) -> bool {
        matches!(self, Self::Tiled | Self::RayonTiled | Self::StaticTiled)
    }

    /// Whether this kernel can run at `precision`. The single source for plan
    /// validation and the default kernel list.
    // Off macOS every kernel supports every precision, leaving `precision` unread.
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    pub(crate) fn supports(self, precision: Precision) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            Self::Mps => matches!(precision, Precision::F16 | Precision::F32),
            _ => true,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum Precision {
    F16,
    F32,
    F64,
    I32,
    I64,
}

impl Precision {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::F16 => "f16",
            Self::F32 => "f32",
            Self::F64 => "f64",
            Self::I32 => "i32",
            Self::I64 => "i64",
        }
    }
}

fn validate_cli(cli: &Cli) -> Result<(), String> {
    if cli.repetitions == 0 {
        return Err("--repetitions must be greater than zero".into());
    }
    if cli.block_size.contains(&0) {
        return Err("all --block-size values must be greater than zero".into());
    }
    if cli.sizes.contains(&0) {
        return Err("all --sizes values must be greater than zero".into());
    }
    if cli.threads.contains(&0) {
        return Err("all --threads values must be greater than zero".into());
    }
    Ok(())
}

/// `static-ikj` and `static-tiled` give every worker at least one row, so a
/// worker count above the smallest matrix dimension cannot be honored and is
/// rejected up front.
fn validate_static_threads(
    kernels: &[KernelChoice],
    threads: &[usize],
    sizes: &[usize],
) -> Result<(), String> {
    if !kernels.contains(&KernelChoice::StaticIkj) && !kernels.contains(&KernelChoice::StaticTiled)
    {
        return Ok(());
    }
    let max_threads = threads.iter().copied().max().unwrap_or(1);
    let min_size = sizes.iter().copied().min().unwrap_or(usize::MAX);
    if max_threads > min_size {
        return Err(format!(
            "static kernels need at least one row per thread; --threads {max_threads} exceeds --sizes {min_size}"
        ));
    }
    Ok(())
}

fn validate_precisions(kernels: &[KernelChoice], precisions: &[Precision]) -> Result<(), String> {
    for &kernel in kernels {
        if let Some(precision) = precisions.iter().find(|&&p| !kernel.supports(p)) {
            return Err(format!(
                "{} does not support {} precision",
                kernel.label(),
                precision.label()
            ));
        }
    }
    Ok(())
}

/// Each run gets its own file, so reruns and other machines add data instead
/// of replacing it. Relative to the working directory: `just bench` runs from the repo root.
// ponytail: two runs on the same host within the same UTC second collide and
// the second silently truncates the first; add sub-second or random suffix
// if that ever bites.
fn default_output_path(host: &str, file_stamp: &str) -> PathBuf {
    Path::new("data/runs")
        .join(host)
        .join(format!("{file_stamp}.csv"))
}

/// `--output` names the CSV file itself.
fn validate_output_path(path: &Path) -> Result<(), String> {
    if path.file_name().is_none() {
        return Err("--output must name a .csv file (e.g. 'results.csv')".into());
    }
    if path.is_dir() {
        return Err(format!(
            "output path '{}' is an existing directory; --output must name a .csv file (e.g. '{}')",
            path.display(),
            path.join("results.csv").display()
        ));
    }
    let is_csv = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"));
    if !is_csv {
        return Err(format!(
            "--output must be a .csv file path (got '{}')",
            path.display()
        ));
    }
    Ok(())
}

/// Creates missing parent directories and opens the output file before any
/// benchmark runs, so an unwritable path fails immediately instead of after
/// the sweep. The file is not truncated here: existing results keep their
/// contents until new records are written.
fn open_output(path: &Path) -> Result<File, String> {
    validate_output_path(path)?;

    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
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

    use clap::{Parser, ValueEnum};

    use super::{
        Cli, Devices, KernelChoice, Precision, default_output_path, open_output,
        validate_output_path,
    };

    /// A per-process `.csv` path under the system temp directory, so tests never
    /// write into the repository and parallel test runs do not collide.
    fn temp_output(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("gemm-bench-test-{}-{name}.csv", std::process::id()))
    }

    #[test]
    fn every_kernel_names_its_backend() {
        for &kernel in KernelChoice::value_variants() {
            #[cfg(target_os = "macos")]
            if kernel == KernelChoice::Mps {
                assert_eq!(kernel.backend(), "metal");
                continue;
            }
            assert_eq!(kernel.backend(), "cpu", "{}", kernel.label());
        }
    }

    #[test]
    fn kernels_report_the_device_of_their_backend() {
        let devices = Devices {
            cpu: "Test CPU".to_owned(),
            #[cfg(target_os = "macos")]
            metal: "Test GPU".to_owned(),
        };
        assert_eq!(KernelChoice::RayonTiled.device(&devices), "Test CPU");
        #[cfg(target_os = "macos")]
        assert_eq!(KernelChoice::Mps.device(&devices), "Test GPU");
    }

    #[test]
    fn empty_sweeps_expand_to_defaults() {
        let output = temp_output("defaults");
        let plan = Cli {
            sizes: Vec::new(),
            threads: Vec::new(),
            kernel: Vec::new(),
            precision: Vec::new(),
            repetitions: 1,
            block_size: vec![64],
            output: Some(output.clone()),
            no_progress: false,
        }
        .into_plan()
        .expect("default plan should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048, 4096]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels.first(), Some(&KernelChoice::Naive));
        #[cfg(target_os = "macos")]
        assert_eq!(plan.kernels.last(), Some(&KernelChoice::Mps));
        #[cfg(not(target_os = "macos"))]
        assert_eq!(plan.kernels.last(), Some(&KernelChoice::StaticTiled));
        assert_eq!(plan.precisions, [Precision::F32]);
        assert!(!plan.no_progress);
        assert!(plan.total_configurations() > 0);
        assert!(!plan.context.host.is_empty());
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn precision_flag_accepts_a_comma_delimited_sweep() {
        let output = temp_output("precision");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--precision"),
            OsStr::new("f16,f64"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("precision list should parse")
        .into_plan()
        .expect("plan should be valid");

        assert_eq!(plan.precisions, [Precision::F16, Precision::F64]);
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn precision_flag_accepts_integer_precisions() {
        let output = temp_output("integers");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--precision"),
            OsStr::new("i32,i64"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("integer precisions should parse")
        .into_plan()
        .expect("plan should be valid");

        assert_eq!(plan.precisions, [Precision::I32, Precision::I64]);
        // CPU kernels support integers; mps does not, so defaults omit it.
        assert_eq!(plan.kernels.last(), Some(&KernelChoice::StaticTiled));
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn static_threads_above_the_matrix_dimension_are_rejected_before_running() {
        let output = temp_output("static-threads");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
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
    fn default_output_is_a_new_file_per_run_under_the_host() {
        assert_eq!(
            default_output_path("Pauls-MacBook-Pro", "20260917T121500Z"),
            PathBuf::from("data/runs/Pauls-MacBook-Pro/20260917T121500Z.csv")
        );
    }

    #[test]
    fn output_accepts_csv_in_any_case() {
        validate_output_path(PathBuf::from("results.csv").as_path()).expect("lowercase csv");
        validate_output_path(PathBuf::from("data/results.CSV").as_path()).expect("uppercase CSV");
    }

    #[test]
    fn output_without_a_csv_extension_is_rejected() {
        for path in ["results", "data/f16.json", ""] {
            let error = validate_output_path(PathBuf::from(path).as_path())
                .expect_err("non-csv output must be rejected");
            assert!(error.contains(".csv"), "{path}: {error}");
        }
    }

    #[test]
    fn output_as_existing_directory_is_rejected() {
        let dir = temp_output("existing_dir");
        fs::create_dir_all(&dir).expect("create test dir");

        let error = validate_output_path(&dir).expect_err("existing directory must be rejected");
        assert!(error.contains("is an existing directory"));

        fs::remove_dir_all(dir).expect("remove test dir");
    }

    #[test]
    fn missing_output_directories_are_created_before_running() {
        let root =
            std::env::temp_dir().join(format!("gemm-bench-test-{}-nested", std::process::id()));
        let output = root.join("a/b/results.csv");

        drop(open_output(&output).expect("missing parent directories should be created"));

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
        let output = temp_output("existing");
        fs::write(&output, b"previous csv").expect("seed existing csv");

        drop(open_output(&output).expect("existing output should open"));

        assert_eq!(
            fs::read(&output).expect("read existing output"),
            b"previous csv"
        );
        let _ = fs::remove_file(output);
    }

    #[test]
    fn no_progress_flag_is_parsed() {
        let output = temp_output("no_progress");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--no-progress"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("plan should be valid");

        assert!(plan.no_progress);
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn total_configurations_counts_worker_and_single_thread_kernels_correctly() {
        let output = temp_output("count");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("64,128"),
            OsStr::new("--precision"),
            OsStr::new("f32,f64"),
            OsStr::new("--kernel"),
            OsStr::new("naive,rayon-ikj"),
            OsStr::new("--threads"),
            OsStr::new("1,2,4"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("plan should be valid");

        // 2 precisions * 2 sizes * (1 for naive + 3 for rayon-ikj) = 2 * 2 * 4 = 16
        assert_eq!(plan.total_configurations(), 16);
        let _ = fs::remove_file(&output);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_parses_as_a_kernel_choice() {
        let output = temp_output("mps");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--kernel"),
            OsStr::new("mps"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("mps kernel should parse")
        .into_plan()
        .expect("mps plan should be valid");

        assert_eq!(plan.kernels, [KernelChoice::Mps]);
        assert_ne!(
            plan.devices.metal, "unknown",
            "a Mac with Metal must name its GPU"
        );
        assert_eq!(plan.total_configurations(), 7); // 7 default sizes * 1 precision * 1 config
        let _ = fs::remove_file(&output);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_with_f64_precision_is_rejected_before_running() {
        let output = temp_output("mps_f64");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--kernel"),
            OsStr::new("mps"),
            OsStr::new("--precision"),
            OsStr::new("f64"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("mps with f64 must be rejected");

        assert!(error.contains("mps does not support f64 precision"));
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_with_integer_precision_is_rejected_before_running() {
        let output = temp_output("mps_i32");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--kernel"),
            OsStr::new("mps"),
            OsStr::new("--precision"),
            OsStr::new("i32"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("mps with i32 must be rejected");

        assert!(error.contains("mps does not support i32 precision"));
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }

    #[test]
    fn block_size_flag_accepts_a_comma_delimited_sweep() {
        let output = temp_output("block-sizes");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--block-size"),
            OsStr::new("32,64,128"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("block-size list should parse")
        .into_plan()
        .expect("plan should be valid");

        assert_eq!(plan.block_sizes, [32, 64, 128]);
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn zero_in_the_block_size_list_is_rejected() {
        let output = temp_output("zero-block");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--block-size"),
            OsStr::new("32,0"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("a zero block size must be rejected");

        assert!(error.contains("--block-size"), "{error}");
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }

    #[test]
    fn block_sizes_multiply_only_the_tiled_kernels() {
        let output = temp_output("block-count");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("64"),
            OsStr::new("--precision"),
            OsStr::new("f32"),
            OsStr::new("--kernel"),
            OsStr::new("ikj,tiled,rayon-tiled"),
            OsStr::new("--threads"),
            OsStr::new("1,2"),
            OsStr::new("--block-size"),
            OsStr::new("32,64,128"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("plan should be valid");

        // ikj 1 + tiled 3 blocks + rayon-tiled 2 threads x 3 blocks = 10
        assert_eq!(plan.total_configurations(), 10);
        assert_eq!(plan.cells(KernelChoice::Ikj), [(1, None)]);
        assert_eq!(
            plan.cells(KernelChoice::Tiled),
            [(1, Some(32)), (1, Some(64)), (1, Some(128))]
        );
        let _ = fs::remove_file(&output);
    }
}

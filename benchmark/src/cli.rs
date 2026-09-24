use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};

use clap::{Parser, ValueEnum};

use crate::config::ConfigFile;
use crate::context::{self, RunContext};

const DEFAULT_SIZES: [usize; 7] = [64, 128, 256, 512, 1024, 2048, 4096];
const DEFAULT_BLOCK_SIZES: [usize; 5] = [16, 32, 64, 128, 256];
const DEFAULT_REPETITIONS: usize = 5;

const AFTER_HELP: &str = "\
Every omitted dimension (--sizes, --threads, --kernel, --precision,
--block-size) sweeps all of its values. With none given, load a preset with
--config or pass --sweep to run everything (hours); otherwise this help is
shown.

Examples:
  gemm-bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
  gemm-bench --config configs/quick.toml
  gemm-bench --config configs/default.toml --sizes 1024
  gemm-bench --sweep

Presets in configs/: default, quick, precisions, block-sizes.";

#[derive(Debug, Parser)]
#[command(about = "Benchmark safe, row-major GEMM kernels", after_help = AFTER_HELP)]
pub(crate) struct Cli {
    /// Matrix dimensions, as a comma-delimited list. Omit to sweep 64 through 4096.
    #[arg(long, value_delimiter = ',')]
    sizes: Vec<usize>,

    /// Worker counts, as a comma-delimited list. Omit to sweep powers of two below available CPUs, plus that maximum.
    #[arg(long, value_delimiter = ',')]
    threads: Vec<usize>,

    /// Kernel(s) to run. Omit to run every kernel.
    #[arg(long, value_delimiter = ',', value_enum)]
    kernel: Vec<KernelChoice>,

    /// Element precision(s), as a comma-delimited list. Omit to sweep all of them.
    #[arg(long, value_delimiter = ',', value_enum)]
    precision: Vec<Precision>,

    /// Number of measured runs per configuration (default 5), after one untimed
    /// warm-up run; records contain their median, minimum, and standard deviation.
    #[arg(long)]
    repetitions: Option<usize>,

    /// Tile edge length(s) for the tiled kernels, as a comma-delimited list.
    /// Omit to sweep 16 through 256.
    #[arg(long, value_delimiter = ',')]
    block_size: Vec<usize>,

    /// Output CSV file. Defaults to a new file per run,
    /// data/runs/<host>/<timestamp>.csv; missing parent directories are created.
    #[arg(long)]
    output: Option<PathBuf>,

    /// Disable the interactive progress bar.
    #[arg(long)]
    no_progress: bool,

    /// Run even though no dimension is pinned: the full sweep, which takes hours.
    #[arg(long)]
    sweep: bool,

    /// TOML preset whose keys are these flags' names; flags given here override it.
    #[arg(long)]
    config: Option<PathBuf>,
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
    /// One line per group of skipped cells, printed before the run.
    pub(crate) skipped: Vec<String>,
}

impl BenchmarkPlan {
    /// The (threads, block size) cells measured for one kernel at one
    /// precision and size; empty when the kernel can't run there. The single
    /// source for the sweep loop and the configuration count.
    pub(crate) fn cells(
        &self,
        kernel: KernelChoice,
        precision: Precision,
        n: usize,
    ) -> Vec<(usize, Option<usize>)> {
        if !kernel.supports(precision) {
            return Vec::new();
        }
        let threads: Vec<usize> = if kernel.uses_workers() {
            self.threads
                .iter()
                .copied()
                .filter(|&t| kernel.fits(t, n))
                .collect()
        } else {
            vec![1]
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
        let mut total = 0;
        for &precision in &self.precisions {
            for &n in &self.sizes {
                for &kernel in &self.kernels {
                    total += self.cells(kernel, precision, n).len();
                }
            }
        }
        total
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
    /// True when nothing narrows the sweep and `--sweep` wasn't given; `main`
    /// shows the help instead of starting an hours-long run.
    pub(crate) fn is_unpinned(&self) -> bool {
        !self.sweep
            && self.config.is_none()
            && self.sizes.is_empty()
            && self.threads.is_empty()
            && self.kernel.is_empty()
            && self.precision.is_empty()
            && self.block_size.is_empty()
    }

    pub(crate) fn into_plan(self) -> Result<BenchmarkPlan, String> {
        let file = match &self.config {
            Some(path) => ConfigFile::load(path)?,
            None => ConfigFile::default(),
        };
        let file_kernels = file
            .kernels()
            .map_err(|error| annotate_config_error(&self.config, error))?;
        let file_precisions = file
            .precisions()
            .map_err(|error| annotate_config_error(&self.config, error))?;
        let explicit_kernels = !self.kernel.is_empty() || file_kernels.is_some();

        let sizes = pick(self.sizes, file.sizes, || DEFAULT_SIZES.to_vec());
        let threads = pick(self.threads, file.threads, default_thread_counts);
        let precisions = pick(self.precision, file_precisions, || {
            Precision::value_variants().to_vec()
        });
        // Every kernel by default; `cells` skips the combinations one can't run.
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut kernels = pick(self.kernel, file_kernels, || {
            KernelChoice::value_variants().to_vec()
        });
        let block_sizes = pick(self.block_size, file.block_size, || {
            DEFAULT_BLOCK_SIZES.to_vec()
        });
        let repetitions = self
            .repetitions
            .or(file.repetitions)
            .unwrap_or(DEFAULT_REPETITIONS);

        // Validate the resolved sweep before touching the filesystem, so a
        // rejected plan never creates directories or an output file.
        validate_values(
            &sizes,
            &threads,
            &kernels,
            &precisions,
            &block_sizes,
            repetitions,
        )?;
        if explicit_kernels {
            reject_idle_kernels(&kernels, &precisions, &threads, &sizes)?;
        }
        #[cfg(target_os = "macos")]
        let bnns_skip = drop_unavailable_bnns(&mut kernels, explicit_kernels, || {
            gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_some()
        })?;
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut skipped = skip_notices(&kernels, &precisions, &threads, &sizes);
        #[cfg(target_os = "macos")]
        skipped.extend(bnns_skip);
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
            repetitions,
            block_sizes,
            context,
            devices,
            output,
            output_path,
            no_progress: self.no_progress,
            skipped,
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
    AccelerateBlas,
    #[cfg(target_os = "macos")]
    AccelerateBnns,
    #[cfg(target_os = "macos")]
    Mps,
}

/// Everything the harness needs to know about a kernel, in one row.
struct KernelInfo {
    /// The `kernel` column in the CSV.
    label: &'static str,
    /// Hardware family. Needed next to `device` because Apple Silicon reports
    /// the same name for its CPU and GPU.
    backend: &'static str,
    precisions: &'static [Precision],
    /// Sweeps `--threads`; the others run on one caller thread.
    workers: bool,
    /// Tiles by `--block-size`; the others record an empty block size.
    blocks: bool,
    /// Gives every worker at least one row, so needs `threads <= n`.
    row_per_worker: bool,
}

impl KernelInfo {
    /// A single-threaded, untiled CPU kernel at every precision; each row in
    /// `KernelChoice::info` overrides what differs.
    fn serial(label: &'static str) -> Self {
        Self {
            label,
            backend: "cpu",
            precisions: Precision::value_variants(),
            workers: false,
            blocks: false,
            row_per_worker: false,
        }
    }
}

impl KernelChoice {
    fn info(self) -> KernelInfo {
        #[cfg(target_os = "macos")]
        use Precision::{F16, F32, F64};
        let serial = KernelInfo::serial;
        match self {
            Self::Naive => serial("naive-ijk"),
            Self::Ikj => serial("ikj"),
            Self::Tiled => KernelInfo {
                blocks: true,
                ..serial("tiled")
            },
            Self::RayonIkj => KernelInfo {
                workers: true,
                ..serial("rayon-ikj")
            },
            Self::RayonTiled => KernelInfo {
                workers: true,
                blocks: true,
                ..serial("rayon-tiled")
            },
            Self::StaticIkj => KernelInfo {
                workers: true,
                row_per_worker: true,
                ..serial("static-ikj")
            },
            Self::StaticTiled => KernelInfo {
                workers: true,
                blocks: true,
                row_per_worker: true,
                ..serial("static-tiled")
            },
            // The AMX matrix coprocessor, reached only through Accelerate,
            // which picks its own threading: one caller thread.
            #[cfg(target_os = "macos")]
            Self::AccelerateBlas => KernelInfo {
                backend: "amx",
                precisions: &[F32, F64],
                ..serial("accelerate-blas")
            },
            #[cfg(target_os = "macos")]
            Self::AccelerateBnns => KernelInfo {
                backend: "amx",
                precisions: &[F16, F32],
                ..serial("accelerate-bnns")
            },
            #[cfg(target_os = "macos")]
            Self::Mps => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32],
                ..serial("mps")
            },
        }
    }

    pub(crate) fn label(self) -> &'static str {
        self.info().label
    }

    pub(crate) fn backend(self) -> &'static str {
        self.info().backend
    }

    pub(crate) fn device(self, devices: &Devices) -> &str {
        #[cfg(target_os = "macos")]
        if self == Self::Mps {
            return &devices.metal;
        }
        &devices.cpu
    }

    pub(crate) fn uses_workers(self) -> bool {
        self.info().workers
    }

    pub(crate) fn uses_blocks(self) -> bool {
        self.info().blocks
    }

    /// Whether the kernel can run `threads` workers on `n` rows.
    pub(crate) fn fits(self, threads: usize, n: usize) -> bool {
        !self.info().row_per_worker || threads <= n
    }

    /// Whether this kernel can run at `precision`. With `fits`, the single
    /// source for skipping cells and rejecting a named kernel with nothing to
    /// run.
    pub(crate) fn supports(self, precision: Precision) -> bool {
        self.info().precisions.contains(&precision)
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

/// Prefixes a config-value error (from `ConfigFile::kernels`/`precisions`)
/// with the file path, matching `ConfigFile::load`'s error shape. These
/// errors only occur when a config was actually given.
fn annotate_config_error(config: &Option<PathBuf>, error: String) -> String {
    match config {
        Some(path) => format!("invalid config '{}': {error}", path.display()),
        None => error,
    }
}

/// A command-line flag wins, then the config key; an omitted dimension sweeps
/// every value.
fn pick<T>(flag: Vec<T>, key: Option<Vec<T>>, all: impl FnOnce() -> Vec<T>) -> Vec<T> {
    if flag.is_empty() {
        key.unwrap_or_else(all)
    } else {
        flag
    }
}

/// Checks the resolved values, so config keys get the same checks as flags.
fn validate_values(
    sizes: &[usize],
    threads: &[usize],
    kernels: &[KernelChoice],
    precisions: &[Precision],
    block_sizes: &[usize],
    repetitions: usize,
) -> Result<(), String> {
    if repetitions == 0 {
        return Err("--repetitions must be greater than zero".into());
    }
    let counts = [
        ("--sizes", sizes.len()),
        ("--threads", threads.len()),
        ("--kernel", kernels.len()),
        ("--precision", precisions.len()),
        ("--block-size", block_sizes.len()),
    ];
    if let Some((flag, _)) = counts.iter().find(|(_, count)| *count == 0) {
        return Err(format!("{flag} needs at least one value"));
    }
    for (flag, values) in [
        ("--sizes", sizes),
        ("--threads", threads),
        ("--block-size", block_sizes),
    ] {
        if values.contains(&0) {
            return Err(format!("all {flag} values must be greater than zero"));
        }
    }
    Ok(())
}

/// A kernel named on the command line that can't run anywhere in the sweep is
/// a mistake worth stopping for; default kernels are only skipped.
fn reject_idle_kernels(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Result<(), String> {
    for &kernel in kernels {
        if !precisions.iter().any(|&p| kernel.supports(p)) {
            let requested: Vec<&str> = precisions.iter().map(|p| p.label()).collect();
            return Err(format!(
                "{} does not support {} precision",
                kernel.label(),
                requested.join(", ")
            ));
        }
        let runnable = sizes
            .iter()
            .any(|&n| threads.iter().any(|&t| kernel.fits(t, n)));
        if kernel.uses_workers() && !runnable {
            return Err(format!(
                "{} needs at least one row per thread; every --threads value exceeds every --sizes value",
                kernel.label()
            ));
        }
    }
    Ok(())
}

/// `accelerate-bnns` is compiled into every macOS build but needs macOS 26 at
/// run time: stop if it was named, otherwise drop it with a notice.
#[cfg(target_os = "macos")]
fn drop_unavailable_bnns(
    kernels: &mut Vec<KernelChoice>,
    explicit: bool,
    available: impl FnOnce() -> bool,
) -> Result<Option<String>, String> {
    if !kernels.contains(&KernelChoice::AccelerateBnns) || available() {
        return Ok(None);
    }
    if explicit {
        return Err("accelerate-bnns needs macOS 26 (the BNNSGraph builder)".to_owned());
    }
    kernels.retain(|&kernel| kernel != KernelChoice::AccelerateBnns);
    Ok(Some("skipping accelerate-bnns (needs macOS 26)".to_owned()))
}

/// One stderr line per group of cells `BenchmarkPlan::cells` leaves out.
fn skip_notices(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Vec<String> {
    let mut notices = Vec::new();
    for &kernel in kernels {
        let unsupported: Vec<&str> = precisions
            .iter()
            .filter(|&&p| !kernel.supports(p))
            .map(|p| p.label())
            .collect();
        if !unsupported.is_empty() {
            notices.push(format!(
                "skipping {} at {} (unsupported precision)",
                kernel.label(),
                unsupported.join(", ")
            ));
        }
        if !kernel.uses_workers() {
            continue;
        }
        for &n in sizes {
            let too_many: Vec<String> = threads
                .iter()
                .filter(|&&t| !kernel.fits(t, n))
                .map(ToString::to_string)
                .collect();
            if !too_many.is_empty() {
                notices.push(format!(
                    "skipping {} with {} threads at n={n} (needs a row per thread)",
                    kernel.label(),
                    too_many.join(",")
                ));
            }
        }
    }
    notices
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
    use std::{ffi::OsString, fs, path::PathBuf};

    use clap::{Parser, ValueEnum};

    #[cfg(target_os = "macos")]
    use super::drop_unavailable_bnns;
    use super::{
        BenchmarkPlan, Cli, Devices, KernelChoice, Precision, default_output_path, open_output,
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
            #[cfg(target_os = "macos")]
            if matches!(
                kernel,
                KernelChoice::AccelerateBlas | KernelChoice::AccelerateBnns
            ) {
                assert_eq!(kernel.backend(), "amx");
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
    fn omitted_dimensions_sweep_every_value() {
        let plan = plan_for("defaults", &["--sweep"]).expect("the full sweep should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048, 4096]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels, KernelChoice::value_variants());
        assert_eq!(plan.precisions, Precision::value_variants());
        assert_eq!(plan.block_sizes, [16, 32, 64, 128, 256]);
        assert_eq!(plan.repetitions, 5);
        assert!(!plan.no_progress);
        assert!(!plan.context.host.is_empty());
    }

    #[test]
    fn only_a_pinned_dimension_or_sweep_skips_the_help() {
        let unpinned = |args: &[&str]| {
            Cli::try_parse_from(std::iter::once("gemm-bench").chain(args.iter().copied()))
                .expect("arguments should parse")
                .is_unpinned()
        };
        assert!(unpinned(&[]));
        assert!(unpinned(&["--no-progress", "--repetitions", "3"]));
        assert!(!unpinned(&["--sweep"]));
        assert!(!unpinned(&["--sizes", "64"]));
        assert!(!unpinned(&["--block-size", "32"]));
    }

    #[test]
    fn precision_flag_accepts_a_comma_delimited_sweep() {
        let plan =
            plan_for("precision", &["--precision", "f16,f64"]).expect("plan should be valid");

        assert_eq!(plan.precisions, [Precision::F16, Precision::F64]);
    }

    #[test]
    fn precision_flag_accepts_integer_precisions() {
        let plan = plan_for("integers", &["--precision", "i32,i64"]).expect("plan should be valid");

        assert_eq!(plan.precisions, [Precision::I32, Precision::I64]);
        // Defaults keep every kernel; mps (no integer support) just has no cells.
        assert_eq!(plan.kernels, KernelChoice::value_variants());
        #[cfg(target_os = "macos")]
        assert!(plan.cells(KernelChoice::Mps, Precision::I32, 64).is_empty());
    }

    #[test]
    fn static_thread_counts_above_a_size_are_skipped_for_that_size() {
        let plan = plan_for(
            "static-skip",
            &[
                "--sizes",
                "8,64",
                "--threads",
                "4,16",
                "--kernel",
                "static-ikj",
                "--precision",
                "f32",
            ],
        )
        .expect("a partly runnable static sweep should be valid");

        assert_eq!(
            plan.cells(KernelChoice::StaticIkj, Precision::F32, 8),
            [(4, None)]
        );
        assert_eq!(
            plan.cells(KernelChoice::StaticIkj, Precision::F32, 64),
            [(4, None), (16, None)]
        );
        assert_eq!(plan.total_configurations(), 3);
        assert_eq!(
            plan.skipped,
            ["skipping static-ikj with 16 threads at n=8 (needs a row per thread)"]
        );
    }

    #[test]
    fn a_static_kernel_with_no_runnable_thread_count_is_rejected_before_running() {
        let error = plan_for(
            "static-idle",
            &["--sizes", "8", "--threads", "16", "--kernel", "static-ikj"],
        )
        .expect_err("a named kernel with nothing to run must be rejected");

        assert!(
            error.contains("static-ikj needs at least one row per thread"),
            "{error}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn default_kernels_skip_mps_at_precisions_it_lacks() {
        let plan = plan_for(
            "mps-skip",
            &["--sizes", "64", "--precision", "f32,f64", "--threads", "1"],
        )
        .expect("unsupported cells of a default kernel are skipped, not rejected");

        assert!(plan.kernels.contains(&KernelChoice::Mps));
        assert_eq!(
            plan.cells(KernelChoice::Mps, Precision::F32, 64),
            [(1, None)]
        );
        assert!(plan.cells(KernelChoice::Mps, Precision::F64, 64).is_empty());
        assert_eq!(
            plan.skipped,
            [
                "skipping accelerate-bnns at f64 (unsupported precision)",
                "skipping mps at f64 (unsupported precision)"
            ]
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
        let plan = plan_for("no_progress", &["--no-progress"]).expect("plan should be valid");

        assert!(plan.no_progress);
    }

    #[test]
    fn total_configurations_counts_worker_and_single_thread_kernels_correctly() {
        let plan = plan_for(
            "count",
            &[
                "--sizes",
                "64,128",
                "--precision",
                "f32,f64",
                "--kernel",
                "naive,rayon-ikj",
                "--threads",
                "1,2,4",
            ],
        )
        .expect("plan should be valid");

        // 2 precisions * 2 sizes * (1 for naive + 3 for rayon-ikj) = 2 * 2 * 4 = 16
        assert_eq!(plan.total_configurations(), 16);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_parses_as_a_kernel_choice() {
        let plan = plan_for("mps", &["--kernel", "mps"]).expect("mps plan should be valid");

        assert_eq!(plan.kernels, [KernelChoice::Mps]);
        assert_ne!(
            plan.devices.metal, "unknown",
            "a Mac with Metal must name its GPU"
        );
        assert_eq!(plan.total_configurations(), 14); // 7 default sizes * mps's 2 precisions (f16, f32)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running() {
        for (kernel, precision) in [
            ("mps", "f64"),
            ("mps", "i32"),
            ("accelerate-blas", "f16"),
            ("accelerate-bnns", "f64"),
        ] {
            let error = plan_for(
                &format!("{kernel}-{precision}"),
                &["--kernel", kernel, "--precision", precision],
            )
            .expect_err("a named kernel with nothing to run must be rejected");
            assert!(
                error.contains(&format!("{kernel} does not support {precision} precision")),
                "{error}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_blas_parses_as_a_single_thread_cpu_kernel() {
        let plan = plan_for(
            "accelerate",
            &["--kernel", "accelerate-blas", "--threads", "1,4"],
        )
        .expect("accelerate-blas plan should be valid");

        assert_eq!(plan.kernels, [KernelChoice::AccelerateBlas]);
        assert_eq!(
            plan.cells(KernelChoice::AccelerateBlas, Precision::F64, 64),
            [(1, None)]
        );
        assert_eq!(plan.total_configurations(), 14); // 7 default sizes * (f32, f64)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn default_kernels_skip_accelerate_blas_at_f16() {
        let plan = plan_for(
            "accelerate-skip",
            &["--sizes", "64", "--precision", "f16,f32", "--threads", "1"],
        )
        .expect("unsupported cells of a default kernel are skipped, not rejected");

        assert!(
            plan.cells(KernelChoice::AccelerateBlas, Precision::F16, 64)
                .is_empty()
        );
        assert_eq!(
            plan.cells(KernelChoice::AccelerateBlas, Precision::F32, 64),
            [(1, None)]
        );
        assert_eq!(
            plan.skipped,
            ["skipping accelerate-blas at f16 (unsupported precision)"]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_bnns_runs_f16_and_f32_on_one_caller_thread() {
        let plan = plan_for(
            "accelerate-bnns",
            &["--kernel", "accelerate-bnns", "--threads", "1,4"],
        )
        .expect("accelerate-bnns plan should be valid");

        assert_eq!(plan.kernels, [KernelChoice::AccelerateBnns]);
        assert_eq!(
            plan.cells(KernelChoice::AccelerateBnns, Precision::F16, 64),
            [(1, None)]
        );
        assert_eq!(plan.total_configurations(), 14); // 7 default sizes * (f16, f32)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_bnns_before_macos_26_is_dropped_by_default_and_rejected_when_named() {
        let mut kernels = vec![KernelChoice::Ikj, KernelChoice::AccelerateBnns];
        let error = drop_unavailable_bnns(&mut kernels, true, || false)
            .expect_err("a named accelerate-bnns must be rejected");
        assert!(error.contains("needs macOS 26"));

        let notice = drop_unavailable_bnns(&mut kernels, false, || false)
            .expect("a default accelerate-bnns is only skipped");
        assert_eq!(kernels, [KernelChoice::Ikj]);
        assert_eq!(
            notice.as_deref(),
            Some("skipping accelerate-bnns (needs macOS 26)")
        );
    }

    #[test]
    fn block_size_flag_accepts_a_comma_delimited_sweep() {
        let plan =
            plan_for("block-sizes", &["--block-size", "32,64,128"]).expect("plan should be valid");

        assert_eq!(plan.block_sizes, [32, 64, 128]);
    }

    #[test]
    fn zero_in_the_block_size_list_is_rejected() {
        let error = plan_for("zero-block", &["--block-size", "32,0"])
            .expect_err("a zero block size must be rejected");

        assert!(error.contains("--block-size"), "{error}");
    }

    #[test]
    fn block_sizes_multiply_only_the_tiled_kernels() {
        let plan = plan_for(
            "block-count",
            &[
                "--sizes",
                "64",
                "--precision",
                "f32",
                "--kernel",
                "ikj,tiled,rayon-tiled",
                "--threads",
                "1,2",
                "--block-size",
                "32,64,128",
            ],
        )
        .expect("plan should be valid");

        // ikj 1 + tiled 3 blocks + rayon-tiled 2 threads x 3 blocks = 10
        assert_eq!(plan.total_configurations(), 10);
        assert_eq!(
            plan.cells(KernelChoice::Ikj, Precision::F32, 64),
            [(1, None)]
        );
        assert_eq!(
            plan.cells(KernelChoice::Tiled, Precision::F32, 64),
            [(1, Some(32)), (1, Some(64)), (1, Some(128))]
        );
    }

    fn temp_config(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "gemm-bench-test-{}-{name}.toml",
            std::process::id()
        ));
        fs::write(&path, body).expect("write test config");
        path
    }

    /// Plans `flags` with a temp `--output`, removed afterwards. Every
    /// rejected plan is also checked to have left no output file behind.
    fn plan_for(name: &str, flags: &[&str]) -> Result<BenchmarkPlan, String> {
        let output = temp_output(name);
        let mut args: Vec<OsString> = vec![
            "gemm-bench".into(),
            "--output".into(),
            output.clone().into(),
        ];
        args.extend(flags.iter().map(OsString::from));
        let plan = Cli::try_parse_from(args)
            .expect("arguments should parse")
            .into_plan();
        if plan.is_err() {
            assert!(
                !output.exists(),
                "a rejected plan must not create the output file"
            );
        }
        let _ = fs::remove_file(output);
        plan
    }

    fn plan_with_config(name: &str, body: &str, flags: &[&str]) -> Result<BenchmarkPlan, String> {
        let config = temp_config(name, body);
        let config_arg = config.to_str().expect("temp paths are UTF-8");
        let plan = plan_for(name, &[&["--config", config_arg], flags].concat());
        let _ = fs::remove_file(config);
        plan
    }

    const PRESET: &str = "sizes = [64]\nkernel = [\"ikj\"]\nprecision = [\"f32\"]\nblock-size = [32]\nrepetitions = 2\n";

    #[test]
    fn config_keys_fill_the_dimensions_flags_omit() {
        let plan = plan_with_config("fill", PRESET, &[]).expect("config plan should be valid");
        assert_eq!(plan.sizes, [64]);
        assert_eq!(plan.kernels, [KernelChoice::Ikj]);
        assert_eq!(plan.precisions, [Precision::F32]);
        assert_eq!(plan.block_sizes, [32]);
        assert_eq!(plan.repetitions, 2);
        assert!(
            plan.threads.contains(&1),
            "an omitted key still sweeps every value"
        );
    }

    #[test]
    fn a_flag_replaces_its_config_key_and_nothing_else() {
        let plan = plan_with_config("override", PRESET, &["--sizes", "128,256"])
            .expect("config plan should be valid");
        assert_eq!(plan.sizes, [128, 256]);
        assert_eq!(plan.kernels, [KernelChoice::Ikj]);
        assert_eq!(plan.repetitions, 2);
    }

    #[test]
    fn a_misspelled_config_key_is_rejected() {
        let error = plan_with_config("typo", "size = [64]\n", &[])
            .expect_err("unknown keys must be rejected");
        assert!(error.contains("unknown field `size`"), "{error}");
    }

    #[test]
    fn an_unknown_kernel_in_a_config_is_rejected() {
        let error = plan_with_config("bad-kernel", "kernel = [\"ijk\"]\n", &[])
            .expect_err("unknown kernel names must be rejected");
        assert!(error.contains("unknown value 'ijk'"), "{error}");
        assert!(error.contains("invalid config '"), "{error}");
    }

    #[test]
    fn an_empty_config_list_is_rejected() {
        let error = plan_with_config("empty", "sizes = []\n", &[])
            .expect_err("an empty dimension must be rejected");
        assert!(
            error.contains("--sizes needs at least one value"),
            "{error}"
        );
    }

    #[test]
    fn a_kernel_named_in_a_config_counts_as_explicit() {
        let error = plan_with_config(
            "idle",
            "kernel = [\"static-ikj\"]\nsizes = [8]\nthreads = [16]\n",
            &[],
        )
        .expect_err("a named kernel with nothing to run must be rejected");
        assert!(
            error.contains("static-ikj needs at least one row per thread"),
            "{error}"
        );
    }

    #[test]
    fn a_config_counts_as_pinning() {
        let cli = Cli::try_parse_from(["gemm-bench", "--config", "configs/quick.toml"])
            .expect("arguments should parse");
        assert!(!cli.is_unpinned());
    }
}

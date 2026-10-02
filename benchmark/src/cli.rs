use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand, ValueEnum};

use crate::config::ConfigFile;
use crate::context;
use crate::kernel::{KernelChoice, Knob, Precision};
use crate::plan::BenchmarkPlan;
use crate::{db, host, machine::Machine};

const DEFAULT_SIZES: [usize; 7] = [64, 128, 256, 512, 1024, 2048, 4096];
const DEFAULT_REPETITIONS: usize = 5;

const AFTER_HELP: &str = "\
Every omitted dimension (--sizes, --threads, --kernel, --precision,
--tile-size, --depth-block) sweeps all of its values. With none given, load a
preset with --config or pass --sweep to run everything (hours); otherwise this
help is shown.

Examples:
  gemm-bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
  gemm-bench --config configs/quick.toml
  gemm-bench --config configs/default.toml --sizes 1024
  gemm-bench --sweep

Presets in configs/: default, quick, precisions, knobs.";

#[derive(Debug, Parser)]
#[command(
    about = "Benchmark safe, row-major GEMM kernels",
    after_help = AFTER_HELP,
    args_conflicts_with_subcommands = true
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Option<Command>,

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

    /// Tile edge(s) for tiled, static-tiled and rayon-tiled, comma-delimited.
    /// Omit to sweep 16 through 256.
    #[arg(long, value_delimiter = ',', visible_alias = "tile")]
    tile_size: Vec<usize>,

    /// Depth of each packed k-block (BLIS's KC) for packed and rayon-packed,
    /// comma-delimited. Omit to sweep 64 through 1024.
    #[arg(long, value_delimiter = ',', visible_alias = "kc")]
    depth_block: Vec<usize>,

    /// Output database. Defaults to data/db/<login>/<machine>.sqlite for the host id in .host (set once with just init); runs are added to an existing file.
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

/// What the CLI does besides running a benchmark.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Check host databases the way CI does before they merge: path, size,
    /// schema, integrity, and every rule that spans rows.
    Validate {
        /// Database files, e.g. data/db/*/*.sqlite.
        #[arg(required = true)]
        dbs: Vec<PathBuf>,
    },
}

impl Cli {
    /// True when nothing narrows the sweep and `--sweep` wasn't given; `main`
    /// shows the help instead of starting an hours-long run.
    pub(crate) fn is_unpinned(&self) -> bool {
        self.command.is_none()
            && !self.sweep
            && self.config.is_none()
            && self.sizes.is_empty()
            && self.threads.is_empty()
            && self.kernel.is_empty()
            && self.precision.is_empty()
            && self.tile_size.is_empty()
            && self.depth_block.is_empty()
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
        let explicit_knobs: Vec<Knob> = [
            (
                Knob::TileSize,
                !self.tile_size.is_empty() || file.tile_size.is_some(),
            ),
            (
                Knob::DepthBlock,
                !self.depth_block.is_empty() || file.depth_block.is_some(),
            ),
        ]
        .into_iter()
        .filter_map(|(knob, explicit)| explicit.then_some(knob))
        .collect();

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
        let tile_sizes = pick(self.tile_size, file.tile_size, || {
            Knob::TileSize.defaults().to_vec()
        });
        let depth_blocks = pick(self.depth_block, file.depth_block, || {
            Knob::DepthBlock.defaults().to_vec()
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
            &tile_sizes,
            &depth_blocks,
            repetitions,
        )?;
        if explicit_kernels {
            reject_idle_kernels(&kernels, &precisions, &threads, &sizes)?;
        }
        #[cfg(target_os = "macos")]
        let bnns_skip = drop_unavailable_bnns(&mut kernels, explicit_kernels, || {
            gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_some()
        })?;
        reject_unused_knobs(&kernels, &explicit_knobs)?;
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut skipped = skip_notices(&kernels, &precisions, &threads, &sizes);
        #[cfg(target_os = "macos")]
        skipped.extend(bnns_skip);
        let context = context::capture();
        let machine = Machine::capture();
        let output_path = match self.output {
            Some(path) => path,
            None => host::db_path(&host::read_host_file(Path::new(host::HOST_FILE))?),
        };
        let db = db::open_for_run(&output_path, &context.timestamp)?;

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            precisions,
            repetitions,
            tile_sizes,
            depth_blocks,
            context,
            machine,
            db,
            output_path,
            no_progress: self.no_progress,
            skipped,
        })
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
    tile_sizes: &[usize],
    depth_blocks: &[usize],
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
        ("--tile-size", tile_sizes.len()),
        ("--depth-block", depth_blocks.len()),
    ];
    if let Some((flag, _)) = counts.iter().find(|(_, count)| *count == 0) {
        return Err(format!("{flag} needs at least one value"));
    }
    for (flag, values) in [
        ("--sizes", sizes),
        ("--threads", threads),
        ("--tile-size", tile_sizes),
        ("--depth-block", depth_blocks),
    ] {
        if values.contains(&0) {
            return Err(format!("all {flag} values must be greater than zero"));
        }
    }
    // A repeat would measure a cell twice, which `validate` rejects only
    // after the run is in the database.
    let repeats = [
        ("--sizes", first_repeat(sizes).map(ToString::to_string)),
        ("--threads", first_repeat(threads).map(ToString::to_string)),
        (
            "--kernel",
            first_repeat(kernels).map(|k| k.label().to_owned()),
        ),
        (
            "--precision",
            first_repeat(precisions).map(|p| p.label().to_owned()),
        ),
        (
            "--tile-size",
            first_repeat(tile_sizes).map(ToString::to_string),
        ),
        (
            "--depth-block",
            first_repeat(depth_blocks).map(ToString::to_string),
        ),
    ];
    if let Some((flag, Some(value))) = repeats.into_iter().find(|(_, value)| value.is_some()) {
        return Err(format!("{flag} lists {value} twice"));
    }
    Ok(())
}

/// The first value that appears earlier in `values` too.
fn first_repeat<T: PartialEq>(values: &[T]) -> Option<&T> {
    values
        .iter()
        .enumerate()
        .find_map(|(i, value)| values[..i].contains(value).then_some(value))
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

/// A knob given explicitly (flag or config key) that no selected kernel
/// sweeps would be silently ignored, so it is a mistake worth stopping for.
fn reject_unused_knobs(kernels: &[KernelChoice], explicit: &[Knob]) -> Result<(), String> {
    for &knob in explicit {
        if kernels.iter().any(|kernel| kernel.knob() == Some(knob)) {
            continue;
        }
        let users: Vec<&str> = KernelChoice::value_variants()
            .iter()
            .filter(|kernel| kernel.knob() == Some(knob))
            .map(|kernel| kernel.label())
            .collect();
        return Err(format!(
            "{} applies only to {}, and none of them is selected",
            knob.flag(),
            users.join(", ")
        ));
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

    use super::Cli;
    #[cfg(target_os = "macos")]
    use super::drop_unavailable_bnns;
    use crate::kernel::{KernelChoice, Precision};
    use crate::plan::BenchmarkPlan;

    /// A per-process `.sqlite` path under the system temp directory, so tests never
    /// write into the repository and parallel test runs do not collide.
    fn temp_output(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "gemm-bench-test-{}-{name}.sqlite",
            std::process::id()
        ))
    }

    #[test]
    fn omitted_dimensions_sweep_every_value() {
        let plan = plan_for("defaults", &["--sweep"]).expect("the full sweep should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048, 4096]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels, KernelChoice::value_variants());
        assert_eq!(plan.precisions, Precision::value_variants());
        assert_eq!(plan.tile_sizes, [16, 32, 64, 128, 256]);
        assert_eq!(plan.depth_blocks, [64, 128, 256, 512, 1024]);
        assert_eq!(plan.repetitions, 5);
        assert!(!plan.no_progress);
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
        assert!(!unpinned(&["--tile-size", "32"]));
        assert!(!unpinned(&["--kc", "256"]));
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
                "skipping mps at f64 (unsupported precision)",
                "skipping metal-naive at f64 (unsupported precision)",
                "skipping metal-tiled at f64 (unsupported precision)"
            ]
        );
    }

    #[test]
    fn missing_output_directories_are_created_before_running() {
        let root =
            std::env::temp_dir().join(format!("gemm-bench-test-{}-nested", std::process::id()));
        let output = root.join("a/b/results.sqlite");

        let plan = Cli::try_parse_from([
            OsString::from("gemm-bench"),
            "--output".into(),
            output.clone().into(),
            "--sizes".into(),
            "8".into(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("missing parent directories should be created");

        drop(plan);
        assert!(output.is_file());
        fs::remove_dir_all(root).expect("remove test directories");
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
        assert!(
            plan.machine.gpu.is_some(),
            "a Mac with Metal must name its GPU"
        );
        assert_eq!(plan.total_configurations(), 14); // 7 default sizes * mps's 2 precisions (f16, f32)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shader_kernels_run_every_gpu_precision_on_the_gpu() {
        let plan = plan_for(
            "metal-shaders",
            &["--kernel", "metal-naive,metal-tiled", "--sizes", "64"],
        )
        .expect("metal shader plan should be valid");

        assert_eq!(
            plan.kernels,
            [KernelChoice::MetalNaive, KernelChoice::MetalTiled]
        );
        assert!(
            plan.machine.gpu.is_some(),
            "a Mac with Metal must name its GPU"
        );
        // 1 size * 2 kernels * (f16, f32, i32, i64); f64 is skipped.
        assert_eq!(plan.total_configurations(), 8);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running() {
        for (kernel, precision) in [
            ("mps", "f64"),
            ("mps", "i32"),
            ("metal-naive", "f64"),
            ("metal-tiled", "f64"),
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
    fn knob_flags_and_their_aliases_accept_comma_delimited_sweeps() {
        let plan = plan_for("knobs", &["--tile", "32,64", "--depth-block", "128,512"])
            .expect("plan should be valid");
        assert_eq!(plan.tile_sizes, [32, 64]);
        assert_eq!(plan.depth_blocks, [128, 512]);
        let plan = plan_for("kc-alias", &["--kc", "256"]).expect("plan should be valid");
        assert_eq!(plan.depth_blocks, [256]);
    }

    #[test]
    fn zero_in_a_knob_list_is_rejected() {
        for flag in ["--tile-size", "--depth-block"] {
            let error = plan_for("zero-knob", &[flag, "32,0"])
                .expect_err("a zero knob value must be rejected");
            assert!(error.contains(flag), "{error}");
        }
    }

    #[test]
    fn each_knob_multiplies_only_the_kernels_that_sweep_it() {
        let plan = plan_for(
            "knob-count",
            &[
                "--sizes",
                "64",
                "--precision",
                "f32",
                "--kernel",
                "ikj,tiled,rayon-tiled,packed",
                "--threads",
                "1,2",
                "--tile-size",
                "32,64,128",
                "--depth-block",
                "256",
            ],
        )
        .expect("plan should be valid");

        // ikj 1 + tiled 3 + rayon-tiled 2 threads x 3 tiles + packed 1 = 11
        assert_eq!(plan.total_configurations(), 11);
        assert_eq!(
            plan.cells(KernelChoice::Ikj, Precision::F32, 64),
            [(1, None)]
        );
        assert_eq!(
            plan.cells(KernelChoice::Tiled, Precision::F32, 64),
            [(1, Some(32)), (1, Some(64)), (1, Some(128))]
        );
        assert_eq!(
            plan.cells(KernelChoice::Packed, Precision::F32, 64),
            [(1, Some(256))]
        );
    }

    #[test]
    fn a_knob_no_selected_kernel_sweeps_is_rejected() {
        let error = plan_for(
            "unused-knob",
            &["--kernel", "ikj,packed", "--tile-size", "32"],
        )
        .expect_err("a knob no selected kernel uses must be rejected");
        assert!(
            error.contains("--tile-size applies only to tiled"),
            "{error}"
        );
    }

    /// A repeated value would measure a cell twice, which `validate` rejects
    /// only after the run is in the host DB.
    #[test]
    fn a_repeated_value_is_rejected_before_running() {
        for (flag, values, repeated) in [
            ("--sizes", "64,128,64", "64"),
            ("--threads", "2,2", "2"),
            ("--kernel", "ikj,ikj", "ikj"),
            ("--precision", "f32,f32", "f32"),
            ("--tile-size", "32,32", "32"),
            ("--depth-block", "256,256", "256"),
        ] {
            let error =
                plan_for("repeat", &[flag, values]).expect_err("a repeated value must be rejected");
            assert!(
                error.contains(&format!("{flag} lists {repeated} twice")),
                "{error}"
            );
        }
    }

    #[test]
    fn the_block_size_flag_is_gone() {
        assert!(Cli::try_parse_from(["gemm-bench", "--block-size", "64"]).is_err());
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

    const PRESET: &str = "sizes = [64]\nkernel = [\"tiled\"]\nprecision = [\"f32\"]\ntile-size = [32]\nrepetitions = 2\n";

    #[test]
    fn config_keys_fill_the_dimensions_flags_omit() {
        let plan = plan_with_config("fill", PRESET, &[]).expect("config plan should be valid");
        assert_eq!(plan.sizes, [64]);
        assert_eq!(plan.kernels, [KernelChoice::Tiled]);
        assert_eq!(plan.precisions, [Precision::F32]);
        assert_eq!(plan.tile_sizes, [32]);
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
        assert_eq!(plan.kernels, [KernelChoice::Tiled]);
        assert_eq!(plan.repetitions, 2);
    }

    #[test]
    fn config_knob_keys_accept_the_blis_alias() {
        let plan = plan_with_config("kc-key", "kernel = [\"packed\"]\nkc = [512]\n", &[])
            .expect("config plan should be valid");
        assert_eq!(plan.depth_blocks, [512]);
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

    #[test]
    fn validate_takes_database_paths_and_needs_one() {
        let cli = Cli::try_parse_from(["gemm-bench", "validate", "a.sqlite", "b.sqlite"])
            .expect("parses");
        assert!(
            matches!(cli.command, Some(super::Command::Validate { ref dbs }) if dbs.len() == 2)
        );
        assert!(Cli::try_parse_from(["gemm-bench", "validate"]).is_err());
    }
}

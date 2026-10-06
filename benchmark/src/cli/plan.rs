use std::path::{Path, PathBuf};

use clap::ValueEnum;

use super::args::{Cli, DEFAULT_REPETITIONS, DEFAULT_SIZES};
#[cfg(target_os = "macos")]
use super::validate::drop_unavailable_bnns;
use super::validate::{reject_idle_kernels, reject_unused_knobs, skip_notices, validate_values};
use crate::config::ConfigFile;
use crate::context;
use crate::kernel::{KernelChoice, Knob, Precision};
use crate::plan::BenchmarkPlan;
use crate::{db, host, hwinfo::Machine};

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
        // Only knob flags typed on the command line: a preset's knob keys
        // serve whichever of its kernels sweep them.
        let explicit_knobs: Vec<Knob> = [
            (Knob::TileSize, !self.tile_size.is_empty()),
            (Knob::DepthBlock, !self.depth_block.is_empty()),
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
            None if cfg!(debug_assertions) => {
                return Err(
                    "a debug build's timings aren't comparable, so it does not write \
                     the host database: use `just bench` (or `cargo run --release`), or pass \
                     --output for a throwaway file"
                        .into(),
                );
            }
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

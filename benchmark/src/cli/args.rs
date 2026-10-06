use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::kernel::{KernelChoice, Precision};

pub(crate) const DEFAULT_SIZES: [usize; 7] = [64, 128, 256, 512, 1024, 2048, 4096];
pub(crate) const DEFAULT_REPETITIONS: usize = 5;

pub(crate) const AFTER_HELP: &str = "\
Every omitted dimension (--sizes, --threads, --kernel, --precision,
--tile-size, --depth-block) sweeps all of its values. With none given, load a
preset with --config or pass --sweep to run everything (hours); otherwise this
help is shown.

Examples:
  gemm-bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
  gemm-bench --config configs/quick.toml
  gemm-bench --config configs/default.toml --sizes 1024
  gemm-bench --sweep

Presets in configs/: default, quick, precisions, knobs, x86, x86-f16.";

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
    pub(crate) sizes: Vec<usize>,

    /// Worker counts, as a comma-delimited list. Omit to sweep powers of two below available CPUs, plus that maximum.
    #[arg(long, value_delimiter = ',')]
    pub(crate) threads: Vec<usize>,

    /// Kernel(s) to run. Omit to run every kernel.
    #[arg(long, value_delimiter = ',', value_enum)]
    pub(crate) kernel: Vec<KernelChoice>,

    /// Element precision(s), as a comma-delimited list. Omit to sweep all of them.
    #[arg(long, value_delimiter = ',', value_enum)]
    pub(crate) precision: Vec<Precision>,

    /// Number of measured runs per configuration (default 5), after one untimed
    /// warm-up run; records contain their median, minimum, and standard deviation.
    #[arg(long)]
    pub(crate) repetitions: Option<usize>,

    /// Tile edge(s) for tiled, static-tiled and rayon-tiled, comma-delimited.
    /// Omit to sweep 16 through 256.
    #[arg(long, value_delimiter = ',', visible_alias = "tile")]
    pub(crate) tile_size: Vec<usize>,

    /// Depth of each packed k-block (BLIS's KC) for packed and rayon-packed,
    /// comma-delimited. Omit to sweep 64 through 1024.
    #[arg(long, value_delimiter = ',', visible_alias = "kc")]
    pub(crate) depth_block: Vec<usize>,

    /// Output database. Defaults to data/db/<login>/<machine>.sqlite for the host id in .host (set once with just init); runs are added to an existing file.
    #[arg(long)]
    pub(crate) output: Option<PathBuf>,

    /// Disable the interactive progress bar.
    #[arg(long)]
    pub(crate) no_progress: bool,

    /// Run even though no dimension is pinned: the full sweep, which takes hours.
    #[arg(long)]
    pub(crate) sweep: bool,

    /// TOML preset whose keys are these flags' names; flags given here override it.
    #[arg(long)]
    pub(crate) config: Option<PathBuf>,
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

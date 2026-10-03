//! The benchmark's vocabulary: which kernels exist, what each one sweeps,
//! which params it records, and which precisions it runs.

use clap::ValueEnum;
use gemm_bench::kernels::Source;

/// Every kernel, on every platform. Off macOS the Apple-only ones are
/// `value(skip)`: the CLI and the default sweep never see them, but
/// `validate` still knows them, since it checks DBs recorded on a Mac.
#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum KernelChoice {
    Naive,
    Ikj,
    Tiled,
    Packed,
    RayonIkj,
    RayonTiled,
    RayonPacked,
    StaticIkj,
    StaticTiled,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    AccelerateBlas,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    AccelerateBnns,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    Mps,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    MetalNaive,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    MetalTiled,
}

/// A knob swept from the command line besides `--threads`: one flag, one
/// default range, recorded under one `params.name`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Knob {
    /// Edge of the square cache tile of the tiled kernels.
    TileSize,
    /// Depth of each packed k-block of the packed kernels (BLIS's KC).
    DepthBlock,
}

impl Knob {
    /// The `params.name` it is recorded under.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::TileSize => "tile_size",
            Self::DepthBlock => "depth_block",
        }
    }

    /// Its CLI flag: the name in kebab case.
    pub(crate) fn flag(self) -> &'static str {
        match self {
            Self::TileSize => "--tile-size",
            Self::DepthBlock => "--depth-block",
        }
    }

    /// The progress bar's short form: BLIS's name where there is one.
    pub(crate) fn short(self) -> &'static str {
        match self {
            Self::TileSize => "tile",
            Self::DepthBlock => "kc",
        }
    }

    /// Swept when its flag is omitted. Tile 1024 hits the power-of-two
    /// aliasing cliff, and KC 16 and 32 measured 25–60% slower than KC 256.
    pub(crate) fn defaults(self) -> &'static [usize] {
        match self {
            Self::TileSize => &[16, 32, 64, 128, 256],
            Self::DepthBlock => &[64, 128, 256, 512, 1024],
        }
    }
}

/// Everything the harness needs to know about a kernel, in one row.
struct KernelInfo {
    /// The `kernel` column.
    label: &'static str,
    /// Hardware family: `cpu`, `matrix` (a matrix unit behind a vendor
    /// library: Apple's AMX, or Arm SME on M4 and later) or `metal`. Needed
    /// next to the device because Apple Silicon names its CPU and GPU alike.
    backend: &'static str,
    precisions: &'static [Precision],
    /// Sweeps `--threads`; the others run on one caller thread.
    workers: bool,
    /// The knob swept besides threads.
    // ponytail: one per kernel; sweep a cartesian product once a kernel needs two.
    knob: Option<Knob>,
    /// Params the kernel works out at run time.
    derived: &'static [&'static str],
    /// Params that are compile-time constants of the kernel.
    fixed: &'static [&'static str],
    /// Gives every worker at least one row, so needs `threads <= n`.
    row_per_worker: bool,
}

const PACKED_FIXED: &[&str] = &["register_rows", "register_col_vectors"];

impl KernelInfo {
    /// A single-threaded CPU kernel with no knobs, at every precision; each
    /// row in `KernelChoice::info` overrides what differs.
    fn serial(label: &'static str) -> Self {
        Self {
            label,
            backend: "cpu",
            precisions: Precision::value_variants(),
            workers: false,
            knob: None,
            derived: &[],
            fixed: &[],
            row_per_worker: false,
        }
    }
}

impl KernelChoice {
    /// Every kernel, including those `value(skip)` hides off macOS.
    pub(crate) const ALL: [Self; 14] = [
        Self::Naive,
        Self::Ikj,
        Self::Tiled,
        Self::Packed,
        Self::RayonIkj,
        Self::RayonTiled,
        Self::RayonPacked,
        Self::StaticIkj,
        Self::StaticTiled,
        Self::AccelerateBlas,
        Self::AccelerateBnns,
        Self::Mps,
        Self::MetalNaive,
        Self::MetalTiled,
    ];

    fn info(self) -> KernelInfo {
        use Precision::{F16, F32, F64, I32, I64};
        let serial = KernelInfo::serial;
        match self {
            Self::Naive => serial("naive-ijk"),
            Self::Ikj => serial("ikj"),
            Self::Tiled => KernelInfo {
                knob: Some(Knob::TileSize),
                ..serial("tiled")
            },
            Self::Packed => KernelInfo {
                knob: Some(Knob::DepthBlock),
                derived: &["depth_block_used", "register_cols"],
                fixed: PACKED_FIXED,
                ..serial("packed")
            },
            Self::RayonIkj => KernelInfo {
                workers: true,
                ..serial("rayon-ikj")
            },
            Self::RayonTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                derived: &["tasks", "rows_per_task"],
                fixed: &["tasks_per_worker"],
                ..serial("rayon-tiled")
            },
            Self::RayonPacked => KernelInfo {
                workers: true,
                knob: Some(Knob::DepthBlock),
                derived: &["depth_block_used", "register_cols", "row_strips"],
                fixed: PACKED_FIXED,
                ..serial("rayon-packed")
            },
            Self::StaticIkj => KernelInfo {
                workers: true,
                derived: &["max_rows_per_thread"],
                row_per_worker: true,
                ..serial("static-ikj")
            },
            Self::StaticTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                derived: &["max_rows_per_thread"],
                row_per_worker: true,
                ..serial("static-tiled")
            },
            // A matrix unit reached only through Accelerate, which picks its
            // own threading: one caller thread.
            Self::AccelerateBlas => KernelInfo {
                backend: "matrix",
                precisions: &[F32, F64],
                ..serial("accelerate-blas")
            },
            Self::AccelerateBnns => KernelInfo {
                backend: "matrix",
                precisions: &[F16, F32],
                ..serial("accelerate-bnns")
            },
            Self::Mps => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32],
                ..serial("mps")
            },
            // Hand-written shaders: MSL has half, float, int and long, but no double.
            Self::MetalNaive => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                derived: &["threadgroup_width", "threadgroup_height", "threadgroups"],
                ..serial("metal-naive")
            },
            Self::MetalTiled => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                derived: &["threadgroups"],
                fixed: &["threadgroup_width", "threadgroup_height", "depth_step"],
                ..serial("metal-tiled")
            },
        }
    }

    /// The kernel recorded under `label`, on any platform.
    pub(crate) fn from_label(label: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kernel| kernel.label() == label)
    }

    pub(crate) fn label(self) -> &'static str {
        self.info().label
    }

    pub(crate) fn backend(self) -> &'static str {
        self.info().backend
    }

    pub(crate) fn uses_workers(self) -> bool {
        self.info().workers
    }

    /// The knob this kernel sweeps besides threads, if any.
    pub(crate) fn knob(self) -> Option<Knob> {
        self.info().knob
    }

    /// Every param this kernel records, with its source, sorted by name: what
    /// `validate` holds each stored measurement to.
    pub(crate) fn declared_params(self) -> Vec<(&'static str, Source)> {
        let info = self.info();
        let mut params: Vec<(&'static str, Source)> = info
            .knob
            .map(|knob| (knob.name(), Source::Swept))
            .into_iter()
            .chain(info.derived.iter().map(|&name| (name, Source::Derived)))
            .chain(info.fixed.iter().map(|&name| (name, Source::Fixed)))
            .collect();
        params.sort_unstable_by_key(|&(name, _)| name);
        params
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

#[cfg(test)]
mod tests {
    use clap::ValueEnum;
    use gemm_bench::kernels::Source;

    use super::{KernelChoice, Knob};

    #[test]
    fn every_kernel_names_its_backend() {
        for kernel in KernelChoice::ALL {
            let expected = match kernel {
                KernelChoice::Mps | KernelChoice::MetalNaive | KernelChoice::MetalTiled => "metal",
                KernelChoice::AccelerateBlas | KernelChoice::AccelerateBnns => "matrix",
                _ => "cpu",
            };
            assert_eq!(kernel.backend(), expected, "{}", kernel.label());
        }
    }

    #[test]
    fn all_kernels_are_known_everywhere_but_offered_only_where_they_run() {
        assert_eq!(KernelChoice::ALL.len(), 14);
        let offered = KernelChoice::value_variants();
        if cfg!(target_os = "macos") {
            assert_eq!(offered, &KernelChoice::ALL[..]);
        } else {
            assert_eq!(offered.len(), 9);
            assert!(offered.iter().all(|kernel| kernel.backend() == "cpu"));
        }
    }

    #[test]
    fn labels_round_trip() {
        for kernel in KernelChoice::ALL {
            assert_eq!(KernelChoice::from_label(kernel.label()), Some(kernel));
        }
        assert_eq!(KernelChoice::from_label("warp-drive"), None);
    }

    #[test]
    fn tiled_kernels_sweep_the_tile_and_packed_kernels_the_depth_block() {
        for &kernel in KernelChoice::value_variants() {
            let expected = match kernel {
                KernelChoice::Tiled | KernelChoice::RayonTiled | KernelChoice::StaticTiled => {
                    Some(Knob::TileSize)
                }
                KernelChoice::Packed | KernelChoice::RayonPacked => Some(Knob::DepthBlock),
                _ => None,
            };
            assert_eq!(kernel.knob(), expected, "{}", kernel.label());
        }
    }

    #[test]
    fn a_kernels_knob_is_its_only_swept_param() {
        for kernel in KernelChoice::ALL {
            let swept: Vec<&str> = kernel
                .declared_params()
                .into_iter()
                .filter(|&(_, source)| source == Source::Swept)
                .map(|(name, _)| name)
                .collect();
            let knob: Vec<&str> = kernel.knob().map(Knob::name).into_iter().collect();
            assert_eq!(swept, knob, "{}", kernel.label());
        }
    }
}

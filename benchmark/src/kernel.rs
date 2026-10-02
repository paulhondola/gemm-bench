//! The benchmark's vocabulary: which kernels exist, what each one sweeps,
//! and which precisions it runs.

use clap::ValueEnum;

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
    #[cfg(target_os = "macos")]
    AccelerateBlas,
    #[cfg(target_os = "macos")]
    AccelerateBnns,
    #[cfg(target_os = "macos")]
    Mps,
    #[cfg(target_os = "macos")]
    MetalNaive,
    #[cfg(target_os = "macos")]
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
    /// The `kernel` column in the CSV.
    label: &'static str,
    /// Hardware family: `cpu`, `matrix` (a matrix unit behind a vendor library) or `metal`. Needed next to `device` because Apple Silicon reports the same name for its CPU and GPU.
    backend: &'static str,
    precisions: &'static [Precision],
    /// Sweeps `--threads`; the others run on one caller thread.
    workers: bool,
    /// The knob swept besides threads.
    // ponytail: one per kernel; sweep a cartesian product once a kernel needs two.
    knob: Option<Knob>,
    /// Gives every worker at least one row, so needs `threads <= n`.
    row_per_worker: bool,
}

impl KernelInfo {
    /// A single-threaded CPU kernel with no knob, at every precision; each row in
    /// `KernelChoice::info` overrides what differs.
    fn serial(label: &'static str) -> Self {
        Self {
            label,
            backend: "cpu",
            precisions: Precision::value_variants(),
            workers: false,
            knob: None,
            row_per_worker: false,
        }
    }
}

impl KernelChoice {
    fn info(self) -> KernelInfo {
        #[cfg(target_os = "macos")]
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
                ..serial("packed")
            },
            Self::RayonIkj => KernelInfo {
                workers: true,
                ..serial("rayon-ikj")
            },
            Self::RayonTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                ..serial("rayon-tiled")
            },
            Self::RayonPacked => KernelInfo {
                workers: true,
                knob: Some(Knob::DepthBlock),
                ..serial("rayon-packed")
            },
            Self::StaticIkj => KernelInfo {
                workers: true,
                row_per_worker: true,
                ..serial("static-ikj")
            },
            Self::StaticTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                row_per_worker: true,
                ..serial("static-tiled")
            },
            // A matrix unit (Apple's AMX, or Arm SME on M4 and later) reached only through Accelerate, which picks its own threading: one caller thread.
            #[cfg(target_os = "macos")]
            Self::AccelerateBlas => KernelInfo {
                backend: "matrix",
                precisions: &[F32, F64],
                ..serial("accelerate-blas")
            },
            #[cfg(target_os = "macos")]
            Self::AccelerateBnns => KernelInfo {
                backend: "matrix",
                precisions: &[F16, F32],
                ..serial("accelerate-bnns")
            },
            #[cfg(target_os = "macos")]
            Self::Mps => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32],
                ..serial("mps")
            },
            // Hand-written shaders: MSL has half, float, int and long, but no double.
            #[cfg(target_os = "macos")]
            Self::MetalNaive => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                ..serial("metal-naive")
            },
            #[cfg(target_os = "macos")]
            Self::MetalTiled => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                ..serial("metal-tiled")
            },
        }
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

    use super::KernelChoice;

    #[test]
    fn every_kernel_names_its_backend() {
        for &kernel in KernelChoice::value_variants() {
            #[cfg(target_os = "macos")]
            if matches!(
                kernel,
                KernelChoice::Mps | KernelChoice::MetalNaive | KernelChoice::MetalTiled
            ) {
                assert_eq!(kernel.backend(), "metal");
                continue;
            }
            #[cfg(target_os = "macos")]
            if matches!(
                kernel,
                KernelChoice::AccelerateBlas | KernelChoice::AccelerateBnns
            ) {
                assert_eq!(kernel.backend(), "matrix");
                continue;
            }
            assert_eq!(kernel.backend(), "cpu", "{}", kernel.label());
        }
    }

    #[test]
    fn tiled_kernels_sweep_the_tile_and_packed_kernels_the_depth_block() {
        use super::Knob;
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
}

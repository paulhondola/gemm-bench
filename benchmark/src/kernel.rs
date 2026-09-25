//! The benchmark's vocabulary: which kernels exist, what each one sweeps,
//! and which precisions it runs.

use clap::ValueEnum;

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
    #[cfg(target_os = "macos")]
    MetalNaive,
    #[cfg(target_os = "macos")]
    MetalTiled,
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
        use Precision::{F16, F32, F64, I32, I64};
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
                assert_eq!(kernel.backend(), "amx");
                continue;
            }
            assert_eq!(kernel.backend(), "cpu", "{}", kernel.label());
        }
    }
}

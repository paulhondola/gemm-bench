use std::{fs::File, path::PathBuf};

use crate::context::{self, RunContext};
use crate::kernel::{KernelChoice, Precision};

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
    pub(crate) fn lookup(kernels: &[KernelChoice]) -> Self {
        Self {
            cpu: context::cpu_name(),
            #[cfg(target_os = "macos")]
            metal: kernels
                .contains(&KernelChoice::Mps)
                .then(gemm_bench::kernels::metal::default_device_name)
                .flatten()
                .unwrap_or_else(|| context::UNKNOWN.to_owned()),
        }
    }

    /// The device `kernel` runs on.
    // Off macOS every kernel is a CPU kernel, leaving `kernel` unread.
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    pub(crate) fn of(&self, kernel: KernelChoice) -> &str {
        #[cfg(target_os = "macos")]
        if kernel == KernelChoice::Mps {
            return &self.metal;
        }
        &self.cpu
    }
}

#[cfg(test)]
mod tests {
    use super::Devices;
    use crate::kernel::KernelChoice;

    #[test]
    fn kernels_report_the_device_of_their_backend() {
        let devices = Devices {
            cpu: "Test CPU".to_owned(),
            #[cfg(target_os = "macos")]
            metal: "Test GPU".to_owned(),
        };
        assert_eq!(devices.of(KernelChoice::RayonTiled), "Test CPU");
        #[cfg(target_os = "macos")]
        assert_eq!(devices.of(KernelChoice::Mps), "Test GPU");
    }
}

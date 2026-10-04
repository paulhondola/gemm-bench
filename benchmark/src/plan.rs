use std::path::PathBuf;

use rusqlite::Connection;

use crate::context::RunContext;
use crate::hwinfo::Machine;
use crate::kernel::{KernelChoice, Knob, Precision};

/// Fully resolved configuration used by the benchmark runner.
#[derive(Debug)]
pub(crate) struct BenchmarkPlan {
    pub(crate) sizes: Vec<usize>,
    pub(crate) threads: Vec<usize>,
    pub(crate) kernels: Vec<KernelChoice>,
    pub(crate) precisions: Vec<Precision>,
    pub(crate) repetitions: usize,
    pub(crate) tile_sizes: Vec<usize>,
    pub(crate) depth_blocks: Vec<usize>,
    pub(crate) context: RunContext,
    /// The machine as it is now, recorded with the run.
    pub(crate) machine: Machine,
    /// Opened and checked before any kernel runs; the run is written into it.
    pub(crate) db: Connection,
    pub(crate) output_path: PathBuf,
    pub(crate) no_progress: bool,
    /// One line per group of skipped cells, printed before the run.
    pub(crate) skipped: Vec<String>,
}

impl BenchmarkPlan {
    /// The values swept for `knob`.
    pub(crate) fn knob_values(&self, knob: Knob) -> &[usize] {
        match knob {
            Knob::TileSize => &self.tile_sizes,
            Knob::DepthBlock => &self.depth_blocks,
        }
    }

    /// The (threads, knob value) cells measured for one kernel at one
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
        let knobs: Vec<Option<usize>> = match kernel.knob() {
            Some(knob) => self.knob_values(knob).iter().copied().map(Some).collect(),
            None => vec![None],
        };
        threads
            .iter()
            .flat_map(|&t| knobs.iter().map(move |&k| (t, k)))
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

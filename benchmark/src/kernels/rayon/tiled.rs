use rayon::prelude::*;

use crate::kernels::{GemmKernel, Param, assert_gemm_dimensions};
use crate::{Element, Matrix};

/// Tasks per worker `rayon-tiled` aims for: no idle rounds, and spare tasks
/// let stealing route around slow cores.
// ponytail: 4 tuned on M1 Pro 8P+2E.
const TASKS_PER_WORKER: usize = 4;

/// How `rayon-tiled` splits `n` rows on `threads` workers, as (tasks, rows per
/// task). Rounding rows up to a whole task can leave fewer tasks than planned,
/// so the count is of the tasks that actually run.
fn split(n: usize, tile: usize, threads: usize) -> (usize, usize) {
    let planned = n
        .div_ceil(tile)
        .max(TASKS_PER_WORKER * threads)
        .div_ceil(threads)
        * threads;
    let rows_per_task = n.div_ceil(planned);
    (n.div_ceil(rows_per_task), rows_per_task)
}

/// Rayon work-stealing implementation, partitioned into row chunks of at most
/// `block_size` rows.
pub struct RayonTiledGemm {
    block_size: usize,
}

impl RayonTiledGemm {
    #[must_use]
    pub fn new(block_size: usize) -> Self {
        assert!(block_size > 0, "block size must be greater than zero");
        Self { block_size }
    }
}

impl<T: Element> GemmKernel<T> for RayonTiledGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        let block_size = self.block_size;
        let (_, chunk_rows) = split(n, block_size, rayon::current_num_threads());
        output.as_mut_slice().fill(T::default());

        // Each task receives an integral group of output rows. `par_chunks`
        // proves those mutable groups are disjoint without pointer arithmetic.
        output
            .as_mut_slice()
            .par_chunks_mut(chunk_rows * n)
            .enumerate()
            .for_each(|(chunk_index, output_rows)| {
                let ii = chunk_index * chunk_rows;

                for kk in (0..n).step_by(block_size) {
                    let k_end = (kk + block_size).min(n);
                    for jj in (0..n).step_by(block_size) {
                        let j_end = (jj + block_size).min(n);
                        for (local_row, output_row) in output_rows.chunks_exact_mut(n).enumerate() {
                            let lhs_row =
                                &lhs.as_slice()[(ii + local_row) * n..(ii + local_row + 1) * n];
                            let output_tile = &mut output_row[jj..j_end];

                            for (&a_ik, rhs_row) in lhs_row[kk..k_end]
                                .iter()
                                .zip(rhs.as_slice()[kk * n..k_end * n].chunks_exact(n))
                            {
                                for (out, &b_kj) in output_tile.iter_mut().zip(&rhs_row[jj..j_end])
                                {
                                    *out += a_ik * b_kj;
                                }
                            }
                        }
                    }
                }
            });
    }

    /// Reads the worker count of the pool it is called in, like `compute`.
    fn params(&self, n: usize) -> Vec<Param> {
        let (tasks, rows_per_task) = split(n, self.block_size, rayon::current_num_threads());
        vec![
            Param::swept("tile_size", self.block_size),
            Param::derived("tasks", tasks),
            Param::derived("rows_per_task", rows_per_task),
            Param::fixed("tasks_per_worker", TASKS_PER_WORKER),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::split;

    #[test]
    fn split_plans_four_tasks_per_worker_and_counts_the_tasks_that_run() {
        // ⌈64/32⌉ = 2 tasks by tile, raised to 4 per worker: 32 tasks of 2 rows.
        assert_eq!(split(64, 32, 8), (32, 2));
        // 12 planned tasks of ⌈100/12⌉ = 9 rows: 12 run.
        assert_eq!(split(100, 64, 3), (12, 9));
        // 16 planned, but 10 rows give only 10 one-row tasks.
        assert_eq!(split(10, 64, 4), (10, 1));
    }
}

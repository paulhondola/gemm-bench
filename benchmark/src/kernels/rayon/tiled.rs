use rayon::prelude::*;

use crate::Matrix;
use crate::kernels::{Element, GemmKernel, assert_gemm_dimensions};

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
        // Aims for ~4 tasks per worker (rounding rows up to a whole chunk can leave a few
        // fewer): no idle rounds, and spare tasks let stealing route around slow cores.
        // ponytail: 4 tuned on M1 Pro 8P+2E.
        let threads = rayon::current_num_threads();
        let tasks = n.div_ceil(block_size).max(4 * threads).div_ceil(threads) * threads;
        let chunk_rows = n.div_ceil(tasks);
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
}

use rayon::prelude::*;

use crate::kernels::packed::{MR, multiply_strip, pack_a, pack_b, params as packed_params};
use crate::kernels::{GemmKernel, Param, assert_gemm_dimensions};
use crate::{Element, Matrix};

/// `packed` with Rayon work stealing over its 8-row strips of C. Each k-block's
/// packed B panel is shared read-only by every task.
pub struct RayonPackedGemm {
    block_size: usize,
}

impl RayonPackedGemm {
    #[must_use]
    pub fn new(block_size: usize) -> Self {
        assert!(block_size > 0, "block size must be greater than zero");
        Self { block_size }
    }
}

impl<T: Element> GemmKernel<T> for RayonPackedGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        output.as_mut_slice().fill(T::default());
        let mut packed_b = Vec::new();

        for pc in (0..n).step_by(self.block_size) {
            let kc = self.block_size.min(n - pc);
            // ponytail: B is packed on the calling thread, an estimated ~8% of an
            // 8-thread run at n = 2048 and ~25% at n = 512 (fit from 4-thread
            // scaling); pack its strips in parallel to win that back.
            pack_b(rhs.as_slice(), n, pc, kc, &mut packed_b);
            output
                .as_mut_slice()
                .par_chunks_mut(MR * n)
                .enumerate()
                // One A buffer per Rayon split, reused across its strips.
                .for_each_init(Vec::new, |packed_a, (strip, c_rows)| {
                    pack_a(lhs.as_slice(), n, strip * MR, pc, kc, packed_a);
                    multiply_strip(packed_a, &packed_b, n, c_rows);
                });
        }
    }

    fn params(&self, n: usize) -> Vec<Param> {
        let mut params = packed_params::<T>(self.block_size, n);
        params.push(Param::derived("row_strips", n.div_ceil(MR)));
        params
    }
}

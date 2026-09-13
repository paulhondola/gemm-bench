use std::thread;

use crate::Matrix;

use super::{GemmKernel, assert_gemm_dimensions, ikj_rows};

/// Fixed, contiguous row chunks using scoped native threads.
///
/// This is the Rust counterpart to OpenMP's `schedule(static)`: task `p`
/// receives a deterministic consecutive range of rows, with no work stealing.
pub struct StaticIkjGemm {
    threads: usize,
}

impl StaticIkjGemm {
    #[must_use]
    pub fn new(threads: usize) -> Self {
        assert!(threads > 0, "thread count must be greater than zero");
        Self { threads }
    }
}

impl GemmKernel for StaticIkjGemm {
    fn name(&self) -> &'static str {
        "static-ikj"
    }

    fn compute(&self, lhs: &Matrix<f32>, rhs: &Matrix<f32>, output: &mut Matrix<f32>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        output.as_mut_slice().fill(0.0);
        let rows_per_thread = n.div_ceil(self.threads);
        let lhs_data = lhs.as_slice();
        let rhs_data = rhs.as_slice();

        thread::scope(|scope| {
            for (chunk_index, output_rows) in output
                .as_mut_slice()
                .chunks_mut(rows_per_thread * n)
                .enumerate()
            {
                let first_row = chunk_index * rows_per_thread;
                scope.spawn(move || ikj_rows(lhs_data, rhs_data, output_rows, first_row, n));
            }
        });
    }
}

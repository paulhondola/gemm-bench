use crate::Matrix;

use super::{GemmKernel, assert_gemm_dimensions, ikj_rows};

/// Sequential `i-k-j` GEMM with contiguous output and RHS accesses.
pub struct IkjGemm;

impl GemmKernel for IkjGemm {
    fn name(&self) -> &'static str {
        "ikj"
    }

    fn compute(&self, lhs: &Matrix<f32>, rhs: &Matrix<f32>, output: &mut Matrix<f32>) {
        assert_gemm_dimensions(lhs, rhs, output);
        output.as_mut_slice().fill(0.0);
        ikj_rows(
            lhs.as_slice(),
            rhs.as_slice(),
            output.as_mut_slice(),
            0,
            lhs.cols(),
        );
    }
}

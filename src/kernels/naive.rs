use crate::Matrix;

use super::{GemmKernel, assert_gemm_dimensions};

/// Canonical sequential `i-j-k` GEMM baseline.
pub struct NaiveGemm;

impl GemmKernel for NaiveGemm {
    fn name(&self) -> &'static str {
        "naive-ijk"
    }

    fn compute(&self, lhs: &Matrix<f64>, rhs: &Matrix<f64>, output: &mut Matrix<f64>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();

        for (lhs_row, output_row) in lhs
            .as_slice()
            .chunks_exact(n)
            .zip(output.as_mut_slice().chunks_exact_mut(n))
        {
            for (column, out) in output_row.iter_mut().enumerate() {
                let mut sum = 0.0;
                for (&a_ik, &b_kj) in lhs_row
                    .iter()
                    .zip(rhs.as_slice()[column..].iter().step_by(n))
                {
                    sum += a_ik * b_kj;
                }
                *out = sum;
            }
        }
    }
}

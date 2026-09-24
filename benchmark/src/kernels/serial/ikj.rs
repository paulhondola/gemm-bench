use crate::kernels::{GemmKernel, assert_gemm_dimensions, ikj_rows};
use crate::{Element, Matrix};

/// Sequential `i-k-j` GEMM with contiguous output and RHS accesses.
pub struct IkjGemm;

impl<T: Element> GemmKernel<T> for IkjGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        output.as_mut_slice().fill(T::default());
        ikj_rows(
            lhs.as_slice(),
            rhs.as_slice(),
            output.as_mut_slice(),
            0,
            lhs.cols(),
        );
    }
}

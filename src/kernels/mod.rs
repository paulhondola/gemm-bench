//! Dense `f64` GEMM kernels sharing one overwrite-style interface.

mod cache_friendly;
mod naive;
mod rayon;
mod static_threads;
mod tiled;

pub use cache_friendly::IkjGemm;
pub use naive::NaiveGemm;
pub use rayon::{RayonIkjGemm, RayonTiledGemm};
pub use static_threads::StaticIkjGemm;
pub use tiled::TiledGemm;

use crate::Matrix;

/// A dense matrix product kernel that computes `output = lhs * rhs`.
///
/// All inputs must have compatible dimensions. Implementations validate that
/// condition at their entry point, then use row slices in the compute loops so
/// LLVM can eliminate repeated index checks and autovectorize contiguous work.
pub trait GemmKernel: Send + Sync {
    fn name(&self) -> &'static str;

    fn compute(&self, lhs: &Matrix<f32>, rhs: &Matrix<f32>, output: &mut Matrix<f32>);
}

pub(crate) fn assert_gemm_dimensions(lhs: &Matrix<f32>, rhs: &Matrix<f32>, output: &Matrix<f32>) {
    assert!(
        lhs.is_square() && rhs.is_square() && output.is_square(),
        "this benchmark supports only square matrices"
    );
    assert!(lhs.rows() > 0, "matrix dimension must be greater than zero");
    assert_eq!(lhs.cols(), rhs.rows(), "incompatible GEMM input dimensions");
    assert_eq!(output.rows(), lhs.rows(), "output row count is incorrect");
    assert_eq!(
        output.cols(),
        rhs.cols(),
        "output column count is incorrect"
    );
}

/// Multiplies contiguous rows using the `i-k-j` order.
///
/// `output_rows` holds whole rows beginning at `first_row`; this form is
/// shared by the Rayon and scoped-thread kernels, whose row slices are known
/// to be disjoint by construction.
pub(crate) fn ikj_rows(
    lhs: &[f32],
    rhs: &[f32],
    output_rows: &mut [f32],
    first_row: usize,
    n: usize,
) {
    debug_assert_eq!(lhs.len(), n * n);
    debug_assert_eq!(rhs.len(), n * n);
    debug_assert_eq!(output_rows.len() % n, 0);

    for (local_row, output_row) in output_rows.chunks_exact_mut(n).enumerate() {
        let lhs_row = &lhs[(first_row + local_row) * n..(first_row + local_row + 1) * n];

        for (&a_ik, rhs_row) in lhs_row.iter().zip(rhs.chunks_exact(n)) {
            for (out, &b_kj) in output_row.iter_mut().zip(rhs_row) {
                *out += a_ik * b_kj;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GemmKernel, IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm, TiledGemm,
    };
    use crate::Matrix;

    fn inputs(n: usize) -> (Matrix<f32>, Matrix<f32>) {
        let lhs = Matrix::from_fn(n, n, |row, col| ((row * 17 + col * 13) % 23) as f32 / 23.0);
        let rhs = Matrix::from_fn(n, n, |row, col| ((row * 7 + col * 19) % 29) as f32 / 29.0);
        (lhs, rhs)
    }

    fn assert_close(actual: &Matrix<f32>, expected: &Matrix<f32>) {
        for (index, (&actual, &expected)) in actual
            .as_slice()
            .iter()
            .zip(expected.as_slice())
            .enumerate()
        {
            assert!(
                (actual - expected).abs() <= 1e-9,
                "element {index}: expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn every_kernel_matches_naive_on_a_non_tile_aligned_matrix() {
        let n = 7;
        let (lhs, rhs) = inputs(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let kernels: Vec<Box<dyn GemmKernel>> = vec![
            Box::new(IkjGemm),
            Box::new(TiledGemm::new(3)),
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
            Box::new(StaticIkjGemm::new(3)),
        ];

        for kernel in kernels {
            let mut actual = Matrix::zeros(n, n);
            kernel.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }
    }
}

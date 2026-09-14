//! Dense floating-point GEMM kernels sharing one overwrite-style interface.

mod cache_friendly;
mod naive;
mod rayon;
mod static_threads;
mod tiled;

use std::ops::{Add, AddAssign, Mul};

pub use cache_friendly::IkjGemm;
pub use naive::NaiveGemm;
pub use rayon::{RayonIkjGemm, RayonTiledGemm};
pub use static_threads::StaticIkjGemm;
pub use tiled::TiledGemm;

use crate::Matrix;

/// A floating-point element type the kernels can multiply.
///
/// `Default` supplies zero for clearing outputs and starting sums. The `f64`
/// conversions let callers build inputs and compare results independently of
/// precision.
pub trait Element:
    Copy + Default + Send + Sync + Add<Output = Self> + Mul<Output = Self> + AddAssign + 'static
{
    fn from_f64(value: f64) -> Self;

    fn to_f64(self) -> f64;
}

macro_rules! impl_element {
    ($($float:ty),*) => {
        $(
            impl Element for $float {
                fn from_f64(value: f64) -> Self {
                    value as $float
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }
        )*
    };
}

impl_element!(f16, f32, f64);

/// A dense matrix product kernel that computes `output = lhs * rhs`.
///
/// All inputs must have compatible dimensions. Implementations validate that
/// condition at their entry point, then use row slices in the compute loops so
/// LLVM can eliminate repeated index checks and autovectorize contiguous work.
pub trait GemmKernel<T: Element>: Send + Sync {
    fn name(&self) -> &'static str;

    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>);
}

pub(crate) fn assert_gemm_dimensions<T>(lhs: &Matrix<T>, rhs: &Matrix<T>, output: &Matrix<T>) {
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
pub(crate) fn ikj_rows<T: Element>(
    lhs: &[T],
    rhs: &[T],
    output_rows: &mut [T],
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
        Element, GemmKernel, IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm,
        TiledGemm,
    };
    use crate::Matrix;

    fn inputs<T: Element>(n: usize) -> (Matrix<T>, Matrix<T>) {
        let lhs = Matrix::from_fn(n, n, |row, col| {
            T::from_f64(((row * 17 + col * 13) % 23) as f64 / 23.0)
        });
        let rhs = Matrix::from_fn(n, n, |row, col| {
            T::from_f64(((row * 7 + col * 19) % 29) as f64 / 29.0)
        });
        (lhs, rhs)
    }

    fn assert_close<T: Element>(actual: &Matrix<T>, expected: &Matrix<T>) {
        for (index, (&actual, &expected)) in actual
            .as_slice()
            .iter()
            .zip(expected.as_slice())
            .enumerate()
        {
            let (actual, expected) = (actual.to_f64(), expected.to_f64());
            assert!(
                (actual - expected).abs() <= 1e-9,
                "element {index}: expected {expected}, got {actual}"
            );
        }
    }

    fn every_kernel_matches_naive<T: Element>() {
        let n = 7;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let kernels: Vec<Box<dyn GemmKernel<T>>> = vec![
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

    #[test]
    fn every_kernel_matches_naive_on_a_non_tile_aligned_matrix() {
        every_kernel_matches_naive::<f16>();
        every_kernel_matches_naive::<f32>();
        every_kernel_matches_naive::<f64>();
    }
}

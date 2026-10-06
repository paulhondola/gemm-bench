use gemm_bench::{Element, GemmKernel, Matrix, kernels::IkjGemm};

pub(crate) fn benchmark_inputs<T: Element>(n: usize) -> (Matrix<T>, Matrix<T>) {
    let lhs = Matrix::from_fn(n, n, |row, col| {
        T::from_ratio((row * 17 + col * 13) % 23, 23)
    });
    let rhs = Matrix::from_fn(n, n, |row, col| {
        T::from_ratio((row * 7 + col * 19) % 29, 29)
    });
    (lhs, rhs)
}

/// Largest element-wise `|output - reference| / |reference|`. A NaN anywhere
/// counts as an infinite error so it can never pass a tolerance check.
pub(crate) fn max_relative_error<T: Element>(output: &Matrix<T>, reference: &Matrix<T>) -> f64 {
    output
        .as_slice()
        .iter()
        .zip(reference.as_slice())
        .map(|(&out, &expected)| {
            let (out, expected) = (out.to_f64(), expected.to_f64());
            let error = (out - expected).abs() / expected.abs().max(f64::MIN_POSITIVE);
            if error.is_nan() { f64::INFINITY } else { error }
        })
        .fold(0.0, f64::max)
}

/// The product of the kernel's own inputs, widened to `f64` and multiplied in
/// `f64`: the ground truth for `mean_rel_error_f64`. Input rounding is not
/// counted, so the error is purely the kernel's arithmetic.
pub(crate) fn f64_reference<T: Element>(lhs: &Matrix<T>, rhs: &Matrix<T>) -> Matrix<f64> {
    let widen = |matrix: &Matrix<T>| {
        Matrix::from_vec(
            matrix.rows(),
            matrix.cols(),
            matrix
                .as_slice()
                .iter()
                .map(|&value| value.to_f64())
                .collect(),
        )
    };
    let mut truth = Matrix::zeros(lhs.rows(), rhs.cols());
    IkjGemm.compute(&widen(lhs), &widen(rhs), &mut truth);
    truth
}

/// Mean over every element of `|truth - output| / |truth|`, against the `f64`
/// ground truth. Informational: it is recorded, never checked against a
/// tolerance. A NaN anywhere makes it infinite, so a broken kernel stays
/// visible instead of dropping out of comparisons.
pub(crate) fn mean_relative_error<T: Element>(output: &Matrix<T>, truth: &Matrix<f64>) -> f64 {
    let total: f64 = output
        .as_slice()
        .iter()
        .zip(truth.as_slice())
        .map(|(&out, &expected)| {
            // An exact zero product (e.g. n = 1, where lhs[0][0] is 0) that the
            // kernel also gets right is 0 / tiny = 0, not 0 / 0 = NaN.
            let error = (out.to_f64() - expected).abs() / expected.abs().max(f64::MIN_POSITIVE);
            if error.is_nan() { f64::INFINITY } else { error }
        })
        .sum();
    total / truth.as_slice().len() as f64
}

/// Rounding slack for kernels that sum each element's `n` products in a
/// different order than the reference: those errors random-walk, growing as `sqrt(n)`.
pub(crate) fn tolerance<T: Element>(n: usize) -> f64 {
    4.0 * (n as f64).sqrt() * T::EPSILON
}

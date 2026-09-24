//! Dense GEMM kernels sharing one overwrite-style interface.

#[cfg(target_os = "macos")]
pub mod accelerate;
pub(crate) mod common;
#[cfg(target_os = "macos")]
pub mod metal;
pub mod rayon;
pub mod serial;
pub mod static_threads;

#[cfg(target_os = "macos")]
pub use accelerate::AccelerateBlasGemm;
#[cfg(target_os = "macos")]
pub use accelerate::AccelerateBnnsGemm;
pub(crate) use common::{assert_gemm_dimensions, ikj_rows};
#[cfg(target_os = "macos")]
pub use metal::{MpsGemm, Shader, ShaderGemm};
pub use rayon::{RayonIkjGemm, RayonTiledGemm};
pub use serial::{IkjGemm, NaiveGemm, TiledGemm};
pub use static_threads::{StaticIkjGemm, StaticTiledGemm};

use crate::{Element, Matrix};

/// A dense matrix product kernel that computes `output = lhs * rhs`.
///
/// All inputs must have compatible dimensions. Implementations validate that
/// condition at their entry point, then use row slices in the compute loops so
/// LLVM can eliminate repeated index checks and autovectorize contiguous work.
pub trait GemmKernel<T: Element>: Send + Sync {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>);
}

#[cfg(test)]
mod tests {
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, RayonIkjGemm, RayonTiledGemm, StaticIkjGemm,
        StaticTiledGemm, TiledGemm,
    };
    use crate::Matrix;

    fn inputs<T: Element>(n: usize) -> (Matrix<T>, Matrix<T>) {
        let lhs = Matrix::from_fn(n, n, |row, col| {
            T::from_ratio((row * 17 + col * 13) % 23, 23)
        });
        let rhs = Matrix::from_fn(n, n, |row, col| {
            T::from_ratio((row * 7 + col * 19) % 29, 29)
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
            // Kernels may add the same terms in a different order (SIMD lanes,
            // GPU fast-math). Measured drift is ~1.3 ε at n = 7 and ~5 ε at
            // n = 256 for every precision, so 8 ε relative leaves headroom.
            let tolerance = 8.0 * T::EPSILON * expected.abs().max(1.0);
            assert!(
                (actual - expected).abs() <= tolerance,
                "element {index}: expected {expected}, got {actual} (tolerance {tolerance:e})"
            );
        }
    }

    fn every_kernel_matches_naive<T: Element>() {
        let n = 7;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let mut kernels: Vec<Box<dyn GemmKernel<T>>> = vec![
            Box::new(IkjGemm),
            Box::new(TiledGemm::new(3)),
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
        ];
        // Every static thread count up to `n`, including uneven row splits.
        for threads in 1..=n {
            kernels.push(Box::new(
                StaticIkjGemm::new(threads).expect("static thread pool should build"),
            ));
            kernels.push(Box::new(
                StaticTiledGemm::new(threads, 3).expect("static tiled thread pool should build"),
            ));
        }

        for kernel in kernels {
            let mut actual = Matrix::zeros(n, n);
            kernel.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }

        // rayon-tiled sizes its row chunks from the pool's thread count.
        for threads in 1..=n {
            let pool = rayon::ThreadPoolBuilder::new()
                .num_threads(threads)
                .build()
                .expect("rayon thread pool should build");
            let mut actual = Matrix::zeros(n, n);
            pool.install(|| RayonTiledGemm::new(3).compute(&lhs, &rhs, &mut actual));
            assert_close(&actual, &expected);
        }
    }

    #[test]
    fn every_kernel_matches_naive_on_a_non_tile_aligned_matrix() {
        every_kernel_matches_naive::<f16>();
        every_kernel_matches_naive::<f32>();
        every_kernel_matches_naive::<f64>();
        every_kernel_matches_naive::<i32>();
        every_kernel_matches_naive::<i64>();
    }

    #[cfg(target_os = "macos")]
    fn accelerate_blas_matches_naive<T: Element>() {
        let n = 7;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);
        let mut actual = Matrix::zeros(n, n);
        super::AccelerateBlasGemm.compute(&lhs, &rhs, &mut actual);
        assert_close(&actual, &expected);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_blas_matches_naive_on_f32_and_f64() {
        accelerate_blas_matches_naive::<f32>();
        accelerate_blas_matches_naive::<f64>();
    }

    #[cfg(target_os = "macos")]
    fn accelerate_bnns_matches_naive<T: Element>() {
        let n = 7;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);
        let kernel = super::AccelerateBnnsGemm::<T>::new(n).expect("BNNSGraph needs macOS 26");
        let mut actual = Matrix::zeros(n, n);
        kernel.compute(&lhs, &rhs, &mut actual);
        assert_close(&actual, &expected);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_bnns_matches_naive_on_f16_and_f32() {
        accelerate_bnns_matches_naive::<f16>();
        accelerate_bnns_matches_naive::<f32>();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accelerate_bnns_has_no_graph_for_other_precisions() {
        assert!(super::AccelerateBnnsGemm::<f64>::new(7).is_none());
        assert!(super::AccelerateBnnsGemm::<i32>::new(7).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_has_no_kernel_for_other_precisions() {
        assert!(super::MpsGemm::<f64>::new().is_none());
        assert!(super::MpsGemm::<i32>::new().is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_matches_naive_on_f16_and_f32() {
        let n = 7;
        {
            let (lhs, rhs) = inputs::<f16>(n);
            let mut expected = Matrix::zeros(n, n);
            NaiveGemm.compute(&lhs, &rhs, &mut expected);
            let mut actual = Matrix::zeros(n, n);
            let mps = super::MpsGemm::<f16>::new().expect("MPS should initialize");
            mps.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }
        {
            let (lhs, rhs) = inputs::<f32>(n);
            let mut expected = Matrix::zeros(n, n);
            NaiveGemm.compute(&lhs, &rhs, &mut expected);
            let mut actual = Matrix::zeros(n, n);
            let mps = super::MpsGemm::<f32>::new().expect("MPS should initialize");
            mps.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mps_benchmark_times_every_repetition_both_ways() {
        let n = 16;
        let (lhs, rhs) = inputs::<f32>(n);
        let mut output = Matrix::zeros(n, n);
        let mps = super::MpsGemm::<f32>::new().expect("MPS should initialize");
        let samples = mps
            .benchmark(&lhs, &rhs, &mut output, 3)
            .expect("the dispatch should succeed");
        assert_eq!((samples.gpu.len(), samples.e2e.len()), (3, 3));
        // End-to-end wraps the GPU-only window, so it can never be shorter.
        assert!(
            samples
                .gpu
                .iter()
                .zip(&samples.e2e)
                .all(|(gpu, e2e)| gpu <= e2e)
        );
    }

    /// Checks a shader against `NaiveGemm` at n = 7 and at n = 37, which is
    /// not a multiple of `metal-tiled`'s 16-wide tile, so edge tiles are partial.
    #[cfg(target_os = "macos")]
    fn shader_matches_naive<T: Element>(shader: super::Shader) {
        for n in [7, 37] {
            let (lhs, rhs) = inputs::<T>(n);
            let mut expected = Matrix::zeros(n, n);
            NaiveGemm.compute(&lhs, &rhs, &mut expected);
            let kernel = super::ShaderGemm::<T>::new(shader)
                .expect("gemm.metal should compile")
                .expect("a Metal device and a precision MSL supports");
            let mut actual = Matrix::zeros(n, n);
            kernel.compute(&lhs, &rhs, &mut actual);
            assert_close(&actual, &expected);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_naive_matches_naive_at_every_gpu_precision() {
        use super::Shader::Naive;
        shader_matches_naive::<f16>(Naive);
        shader_matches_naive::<f32>(Naive);
        shader_matches_naive::<i32>(Naive);
        shader_matches_naive::<i64>(Naive);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shaders_have_no_kernel_for_f64() {
        let kernel = super::ShaderGemm::<f64>::new(super::Shader::Naive)
            .expect("an unsupported precision is not a compile error");
        assert!(kernel.is_none());
    }
}

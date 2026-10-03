//! Dense GEMM kernels sharing one overwrite-style interface.

#[cfg(target_os = "macos")]
pub mod accelerate;
pub(crate) mod common;
#[cfg(target_os = "macos")]
pub mod metal;
pub(crate) mod packed;
mod param;
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
pub use param::{Param, Source};
pub use rayon::{RayonIkjGemm, RayonPackedGemm, RayonTiledGemm};
pub use serial::{IkjGemm, NaiveGemm, PackedGemm, TiledGemm};
pub use static_threads::{StaticIkjGemm, StaticTiledGemm};

use crate::{Element, Matrix};

/// A dense matrix product kernel that computes `output = lhs * rhs`.
///
/// All inputs must have compatible dimensions. Implementations validate that
/// condition at their entry point, then use row slices in the compute loops so
/// LLVM can eliminate repeated index checks and autovectorize contiguous work.
pub trait GemmKernel<T: Element>: Send + Sync {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>);

    /// The knob values this kernel uses at size `n`, as the `params` table
    /// records them. Empty for kernels with no knobs.
    fn params(&self, _n: usize) -> Vec<Param> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Element, GemmKernel, IkjGemm, NaiveGemm, PackedGemm, Param, RayonIkjGemm, RayonPackedGemm,
        RayonTiledGemm, StaticIkjGemm, StaticTiledGemm, TiledGemm,
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
            Box::new(PackedGemm::new(3)),
            Box::new(RayonIkjGemm),
            Box::new(RayonTiledGemm::new(3)),
            Box::new(RayonPackedGemm::new(3)),
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

    /// n = 37 with a 16-deep k-block splits every dimension into full and
    /// partial packed blocks: rows 4×8 + 5; columns 3×12 + 1 (f32, i32),
    /// 24 + 13 (f16), 6×6 + 1 (f64, i64); k 2×16 + 5. n = 7 alone never fills
    /// a whole 8-row block.
    fn packed_matches_naive<T: Element>() {
        let n = 37;
        let (lhs, rhs) = inputs::<T>(n);
        let mut expected = Matrix::zeros(n, n);
        NaiveGemm.compute(&lhs, &rhs, &mut expected);

        let mut actual = Matrix::zeros(n, n);
        PackedGemm::new(16).compute(&lhs, &rhs, &mut actual);
        assert_close(&actual, &expected);

        // Three workers, so strips of one k-block run concurrently.
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(3)
            .build()
            .expect("rayon thread pool should build");
        let mut actual = Matrix::zeros(n, n);
        pool.install(|| RayonPackedGemm::new(16).compute(&lhs, &rhs, &mut actual));
        assert_close(&actual, &expected);
    }

    #[test]
    fn packed_kernels_match_naive_across_full_and_partial_blocks() {
        packed_matches_naive::<f16>();
        packed_matches_naive::<f32>();
        packed_matches_naive::<f64>();
        packed_matches_naive::<i32>();
        packed_matches_naive::<i64>();
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
        // Allocating the three shared buffers is timed once, as setup.
        assert!(samples.setup > std::time::Duration::ZERO);
    }

    /// Checks a shader against `NaiveGemm` at n = 7, 37 and 100, none a multiple
    /// of `metal-tiled`'s 16-wide tile, so edge tiles are partial.
    #[cfg(target_os = "macos")]
    fn shader_matches_naive<T: Element>(shader: super::Shader) {
        // 100 spans two blocks per side for metal-simdgroup, the second ragged,
        // and ends its k-loop on a partial step. 132 is a multiple of 4 that
        // puts interior blocks at nonzero row0/col0 on the vector path, with a
        // ragged 4-wide edge.
        for n in [7, 37, 100, 132] {
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
    fn metal_tiled_matches_naive_at_every_gpu_precision() {
        use super::Shader::Tiled;
        shader_matches_naive::<f16>(Tiled);
        shader_matches_naive::<f32>(Tiled);
        shader_matches_naive::<i32>(Tiled);
        shader_matches_naive::<i64>(Tiled);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_simdgroup_matches_naive_at_f16_and_f32() {
        use super::Shader::Simdgroup;
        shader_matches_naive::<f16>(Simdgroup);
        shader_matches_naive::<f32>(Simdgroup);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_simdgroup_has_no_kernel_for_integers() {
        use super::{Shader::Simdgroup, ShaderGemm};
        let int = ShaderGemm::<i32>::new(Simdgroup)
            .expect("an unsupported precision is not a compile error");
        let long = ShaderGemm::<i64>::new(Simdgroup)
            .expect("an unsupported precision is not a compile error");
        assert!(int.is_none() && long.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shaders_have_no_kernel_for_f64() {
        let kernel = super::ShaderGemm::<f64>::new(super::Shader::Naive)
            .expect("an unsupported precision is not a compile error");
        assert!(kernel.is_none());
    }

    #[test]
    fn kernels_without_knobs_record_no_params() {
        assert!(GemmKernel::<f32>::params(&IkjGemm, 64).is_empty());
        assert!(GemmKernel::<f32>::params(&NaiveGemm, 64).is_empty());
    }

    #[test]
    fn tiled_records_its_tile() {
        assert_eq!(
            GemmKernel::<f32>::params(&TiledGemm::new(32), 64),
            [Param::swept("tile_size", 32)]
        );
    }

    #[test]
    fn packed_records_the_requested_and_the_used_depth_block() {
        assert_eq!(
            GemmKernel::<f32>::params(&PackedGemm::new(1024), 512),
            [
                Param::swept("depth_block", 1024),
                Param::derived("depth_block_used", 512),
                Param::derived("register_cols", 12),
                Param::fixed("register_rows", 8),
                Param::fixed("register_col_vectors", 3),
            ]
        );
        let cols = |params: Vec<Param>| {
            params
                .into_iter()
                .find(|p| p.name == "register_cols")
                .map(|p| p.value)
        };
        assert_eq!(
            cols(GemmKernel::<f16>::params(&PackedGemm::new(64), 512)),
            Some(24)
        );
        assert_eq!(
            cols(GemmKernel::<f64>::params(&PackedGemm::new(64), 512)),
            Some(6)
        );
    }

    #[test]
    fn rayon_packed_adds_its_row_strips() {
        let params = GemmKernel::<f32>::params(&RayonPackedGemm::new(256), 100);
        assert!(params.contains(&Param::derived("row_strips", 13)));
        assert!(params.contains(&Param::derived("depth_block_used", 100)));
    }

    #[test]
    fn rayon_tiled_records_the_split_of_the_pool_it_runs_in() {
        let pool = ::rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .build()
            .expect("a 4-thread pool");
        let params = pool.install(|| GemmKernel::<f32>::params(&RayonTiledGemm::new(64), 10));
        assert_eq!(
            params,
            [
                Param::swept("tile_size", 64),
                // 16 tasks are planned for 4 workers, but 10 rows make 10 one-row tasks.
                Param::derived("tasks", 10),
                Param::derived("rows_per_task", 1),
                Param::fixed("tasks_per_worker", 4),
            ]
        );
    }

    #[test]
    fn static_kernels_record_their_largest_row_share() {
        let ikj = StaticIkjGemm::new(3).expect("a 3-thread pool");
        assert_eq!(
            GemmKernel::<f32>::params(&ikj, 10),
            [Param::derived("max_rows_per_thread", 4)]
        );
        let tiled = StaticTiledGemm::new(3, 32).expect("a 3-thread pool");
        assert_eq!(
            GemmKernel::<f32>::params(&tiled, 10),
            [
                Param::swept("tile_size", 32),
                Param::derived("max_rows_per_thread", 4),
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shaders_record_their_threadgroups() {
        use super::{Shader, ShaderGemm};
        let tiled = ShaderGemm::<f32>::new(Shader::Tiled)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        assert_eq!(
            GemmKernel::<f32>::params(&tiled, 100),
            [
                Param::fixed("threadgroup_width", 16),
                Param::fixed("threadgroup_height", 16),
                Param::fixed("depth_step", 16),
                Param::derived("threadgroups", 49),
            ]
        );
        let simdgroup = ShaderGemm::<f32>::new(Shader::Simdgroup)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        assert_eq!(
            GemmKernel::<f32>::params(&simdgroup, 100),
            [
                Param::fixed("block_rows", 64),
                Param::fixed("block_cols", 64),
                Param::fixed("depth_step", 16),
                Param::fixed("simdgroups", 4),
                Param::derived("threadgroups", 4),
            ]
        );
        let naive = ShaderGemm::<f32>::new(Shader::Naive)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        let params = GemmKernel::<f32>::params(&naive, 100);
        let value = |name: &str| {
            params
                .iter()
                .find(|p| p.name == name)
                .map(|p| p.value)
                .unwrap_or_else(|| panic!("{name} is missing"))
        };
        let (width, height) = (value("threadgroup_width"), value("threadgroup_height"));
        assert!(width * height <= 1024, "{width}x{height}");
        assert_eq!(
            value("threadgroups"),
            100usize.div_ceil(width) * 100usize.div_ceil(height)
        );
    }
}

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

//! Building blocks for benchmarking dense, row-major `f64` matrix products.
//!
//! Kernels deliberately overwrite their output matrix: after
//! `kernel.compute(&a, &b, &mut c)`, `c == a * b`.

pub mod kernels;
pub mod matrix;

pub use kernels::GemmKernel;
pub use matrix::Matrix;

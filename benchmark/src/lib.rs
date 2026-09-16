//! Building blocks for benchmarking dense, row-major matrix products at
//! `f16`, `f32`, `f64`, `i32`, or `i64` precision.
//!
//! Kernels deliberately overwrite their output matrix: after
//! `kernel.compute(&a, &b, &mut c)`, `c == a * b`.

#![feature(f16)]

pub mod kernels;
pub mod matrix;

pub use kernels::{Element, GemmKernel};
pub use matrix::Matrix;

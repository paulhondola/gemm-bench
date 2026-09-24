//! Apple's vendor CPU BLAS: `cblas_sgemm`/`cblas_dgemm` from Accelerate, whose
//! Level-3 routines run on the AMX matrix coprocessor on Apple Silicon.

use std::any::TypeId;
use std::ffi::c_int;

use crate::Matrix;
use crate::kernels::{Element, GemmKernel, assert_gemm_dimensions};

const CBLAS_ROW_MAJOR: c_int = 101;
const CBLAS_NO_TRANS: c_int = 111;

#[link(name = "Accelerate", kind = "framework")]
unsafe extern "C" {
    fn cblas_sgemm(
        order: c_int,
        transa: c_int,
        transb: c_int,
        m: c_int,
        n: c_int,
        k: c_int,
        alpha: f32,
        a: *const f32,
        lda: c_int,
        b: *const f32,
        ldb: c_int,
        beta: f32,
        c: *mut f32,
        ldc: c_int,
    );
    fn cblas_dgemm(
        order: c_int,
        transa: c_int,
        transb: c_int,
        m: c_int,
        n: c_int,
        k: c_int,
        alpha: f64,
        a: *const f64,
        lda: c_int,
        b: *const f64,
        ldb: c_int,
        beta: f64,
        c: *mut f64,
        ldc: c_int,
    );
}

/// `output = lhs * rhs` through Accelerate BLAS. Only `f32` and `f64`: BLAS
/// has no half-precision or integer GEMM, and `KernelChoice::supports` keeps
/// the harness from asking for them.
///
/// Accelerate picks its own threading, so one call may use AMX and several
/// cores; the harness records it as one caller thread.
pub struct AccelerateBlasGemm;

impl<T: Element> GemmKernel<T> for AccelerateBlasGemm {
    fn name(&self) -> &'static str {
        "accelerate-blas"
    }

    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = c_int::try_from(lhs.rows()).expect("matrix dimension exceeds BLAS's i32 range");
        let (a, b, c) = (
            lhs.as_slice().as_ptr(),
            rhs.as_slice().as_ptr(),
            output.as_mut_slice().as_mut_ptr(),
        );
        // ponytail: TypeId dispatch instead of a per-precision supertrait on
        // `Element` (the `MpsBench` pattern); both branches fold away after
        // monomorphization.
        // SAFETY: the TypeId check proves `T` is the pointee type each cast
        // names; the asserted dimensions make every buffer n*n long and
        // row-major with leading dimension n; `output` is borrowed mutably,
        // so it can't alias the inputs.
        unsafe {
            if TypeId::of::<T>() == TypeId::of::<f32>() {
                cblas_sgemm(
                    CBLAS_ROW_MAJOR,
                    CBLAS_NO_TRANS,
                    CBLAS_NO_TRANS,
                    n,
                    n,
                    n,
                    1.0,
                    a.cast(),
                    n,
                    b.cast(),
                    n,
                    0.0,
                    c.cast(),
                    n,
                );
            } else if TypeId::of::<T>() == TypeId::of::<f64>() {
                cblas_dgemm(
                    CBLAS_ROW_MAJOR,
                    CBLAS_NO_TRANS,
                    CBLAS_NO_TRANS,
                    n,
                    n,
                    n,
                    1.0,
                    a.cast(),
                    n,
                    b.cast(),
                    n,
                    0.0,
                    c.cast(),
                    n,
                );
            } else {
                panic!("Accelerate BLAS has no GEMM for this precision; use f32 or f64");
            }
        }
    }
}

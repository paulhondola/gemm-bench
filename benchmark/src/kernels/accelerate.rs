//! Apple's vendor CPU GEMM from Accelerate, which runs on the AMX matrix
//! coprocessor on Apple Silicon: `cblas_sgemm`/`cblas_dgemm` for `f32`/`f64`,
//! and BNNS's `BNNSMatMul` for `f16` (BLAS has no half-precision GEMM).

use std::any::TypeId;
use std::ffi::{c_int, c_void};
use std::ptr;

use crate::Matrix;
use crate::kernels::{Element, GemmKernel, assert_gemm_dimensions};

const CBLAS_ROW_MAJOR: c_int = 101;
const CBLAS_NO_TRANS: c_int = 111;

// `bnns_constants.h` enum values; every BNNS enum is 4 bytes.
const BNNS_DATA_TYPE_FLOAT16: u32 = 0x10000 | 16;
const BNNS_DATA_LAYOUT_ROW_MAJOR_MATRIX: u32 = 0x20000;

/// `BNNSNDArrayDescriptor` from `bnns_structures.h`. `repr(C)` reproduces the
/// SDK layout (176 bytes: `data` at offset 136, `data_type` at 144), checked
/// with `offsetof` against the macOS 27 SDK.
#[repr(C)]
struct BnnsNdArrayDescriptor {
    flags: u32,
    layout: u32,
    size: [usize; 8],
    stride: [usize; 8],
    data: *mut c_void,
    data_type: u32,
    table_data: *mut c_void,
    table_data_type: u32,
    data_scale: f32,
    data_bias: f32,
}

#[link(name = "Accelerate", kind = "framework")]
unsafe extern "C" {
    /// Deprecated since macOS 15 in favour of `BNNSGraph*`, whose C API only
    /// loads compiled Core ML models; still exported and the only direct f16
    /// matmul Accelerate has.
    fn BNNSMatMul(
        trans_a: bool,
        trans_b: bool,
        alpha: f32,
        input_a: *const BnnsNdArrayDescriptor,
        input_b: *const BnnsNdArrayDescriptor,
        output: *const BnnsNdArrayDescriptor,
        workspace: *mut c_void,
        filter_params: *const c_void,
    ) -> c_int;
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

/// Describes a contiguous row-major `n`×`n` `f16` matrix at `data` for BNNS.
fn f16_matrix_descriptor(data: *mut c_void, n: usize) -> BnnsNdArrayDescriptor {
    let (rows, cols) = (n, n);
    let mut size = [0; 8];
    let mut stride = [0; 8];
    // RowMajorMatrix puts (row, col) at `col * stride[0] + row * stride[1]`,
    // with size[0] = columns and size[1] = rows (the reverse of 2DFirstMajor).
    size[..2].copy_from_slice(&[cols, rows]);
    stride[..2].copy_from_slice(&[1, cols]);
    BnnsNdArrayDescriptor {
        flags: 0,
        layout: BNNS_DATA_LAYOUT_ROW_MAJOR_MATRIX,
        size,
        stride,
        data,
        data_type: BNNS_DATA_TYPE_FLOAT16,
        table_data: ptr::null_mut(),
        table_data_type: 0,
        data_scale: 1.0,
        data_bias: 0.0,
    }
}

/// `output = lhs * rhs` through Accelerate. `f32` and `f64` go through BLAS,
/// `f16` through BNNS; neither has an integer GEMM, and
/// `KernelChoice::supports` keeps the harness from asking for one.
///
/// Accelerate picks its own threading, so one call may use AMX and several
/// cores; the harness records it as one caller thread.
pub struct AccelerateGemm;

impl<T: Element> GemmKernel<T> for AccelerateGemm {
    fn name(&self) -> &'static str {
        "accelerate"
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
        // so it can't alias the inputs. BNNS only reads through the input
        // descriptors (the casts to `*mut` satisfy its C signature), and the
        // descriptors don't outlive the borrows they point into.
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
            } else if TypeId::of::<T>() == TypeId::of::<f16>() {
                let n = lhs.rows();
                let a = f16_matrix_descriptor(a.cast_mut().cast(), n);
                let b = f16_matrix_descriptor(b.cast_mut().cast(), n);
                let c = f16_matrix_descriptor(c.cast(), n);
                // ponytail: null workspace makes BNNS allocate its scratch
                // inside the timed call; hoist a `BNNSMatMulWorkspaceSize`
                // buffer into the kernel if that shows up at small n.
                let status =
                    BNNSMatMul(false, false, 1.0, &a, &b, &c, ptr::null_mut(), ptr::null());
                assert_eq!(status, 0, "BNNSMatMul failed for f16 at n = {n}");
            } else {
                panic!("Accelerate has no GEMM for this precision; use f16, f32 or f64");
            }
        }
    }
}

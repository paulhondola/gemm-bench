//! Apple's BNNSGraph matmul from Accelerate, which runs on the AMX matrix
//! coprocessor on Apple Silicon. The graph builder is Swift-only (macOS 26+),
//! so this calls the shim in `benchmark/swift/BnnsGraph`, which `build.rs`
//! compiles and links.

use std::any::TypeId;
use std::ffi::c_void;
use std::marker::PhantomData;
use std::ptr::NonNull;
use std::sync::Mutex;

use crate::kernels::{GemmKernel, assert_gemm_dimensions};
use crate::{Element, Matrix};

unsafe extern "C" {
    fn bnns_graph_make_f16(n: isize) -> *mut c_void;
    fn bnns_graph_make_f32(n: isize) -> *mut c_void;
    fn bnns_graph_run(
        graph: *mut c_void,
        a: *const c_void,
        b: *const c_void,
        c: *mut c_void,
    ) -> i32;
    fn bnns_graph_free(graph: *mut c_void);
}

/// Owning handle to a retained Swift `Graph`.
struct Graph(NonNull<c_void>);

// SAFETY: a BNNSGraph context isn't tied to the thread that built it; the
// `Mutex` around the handle keeps two threads from executing it (and racing
// on its workspace) at once.
unsafe impl Send for Graph {}

impl Drop for Graph {
    fn drop(&mut self) {
        // SAFETY: the pointer came from `bnns_graph_make_*` and is released once.
        unsafe { bnns_graph_free(self.0.as_ptr()) }
    }
}

/// `output = lhs * rhs` through a BNNSGraph compiled for one `n`×`n` size.
/// Only `f16` and `f32`: BNNSGraph has no `f64`, and integer matmul graphs
/// compile but fail to execute. `f16` accumulates in `f16`, unlike BLAS.
///
/// Like `accelerate-blas`, Accelerate picks its own threading, so the harness
/// records one caller thread.
pub struct AccelerateBnnsGemm<T> {
    graph: Mutex<Graph>,
    n: usize,
    _marker: PhantomData<T>,
}

impl<T: Element> AccelerateBnnsGemm<T> {
    /// Compiles the graph for `n`×`n` inputs, outside any timed region.
    /// `None` before macOS 26 or for a precision other than `f16`/`f32`.
    #[must_use]
    pub fn new(n: usize) -> Option<Self> {
        let size = isize::try_from(n).ok()?;
        // SAFETY: plain calls taking an integer; null signals failure.
        let graph = unsafe {
            if TypeId::of::<T>() == TypeId::of::<f16>() {
                bnns_graph_make_f16(size)
            } else if TypeId::of::<T>() == TypeId::of::<f32>() {
                bnns_graph_make_f32(size)
            } else {
                return None;
            }
        };
        Some(Self {
            graph: Mutex::new(Graph(NonNull::new(graph)?)),
            n,
            _marker: PhantomData,
        })
    }
}

impl<T: Element> GemmKernel<T> for AccelerateBnnsGemm<T> {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        assert_eq!(
            lhs.rows(),
            self.n,
            "graph was compiled for a different size"
        );
        let graph = self.graph.lock().expect("a BNNSGraph run panicked");
        // SAFETY: `new` built the graph for `T` at this `n`, so every buffer
        // is n*n row-major `T`s; the shim only reads `a` and `b`, and
        // `output` is borrowed mutably, so it can't alias them.
        let status = unsafe {
            bnns_graph_run(
                graph.0.as_ptr(),
                lhs.as_slice().as_ptr().cast(),
                rhs.as_slice().as_ptr().cast(),
                output.as_mut_slice().as_mut_ptr().cast(),
            )
        };
        assert_eq!(status, 0, "BNNSGraph matmul failed at n = {}", self.n);
    }
}

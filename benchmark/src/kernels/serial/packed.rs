use crate::kernels::packed::{MR, multiply_strip, pack_a, pack_b};
use crate::kernels::{GemmKernel, assert_gemm_dimensions};
use crate::{Element, Matrix};

/// Sequential packed GEMM: operands copied into k-major strips, multiplied by
/// a `std::simd` micro-kernel that keeps an 8-row block of C in registers.
/// The block size is the k-block (KC), the depth of each packed B panel.
pub struct PackedGemm {
    block_size: usize,
}

impl PackedGemm {
    #[must_use]
    pub fn new(block_size: usize) -> Self {
        assert!(block_size > 0, "block size must be greater than zero");
        Self { block_size }
    }
}

impl<T: Element> GemmKernel<T> for PackedGemm {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        output.as_mut_slice().fill(T::default());
        let (mut packed_a, mut packed_b) = (Vec::new(), Vec::new());

        for pc in (0..n).step_by(self.block_size) {
            let kc = self.block_size.min(n - pc);
            pack_b(rhs.as_slice(), n, pc, kc, &mut packed_b);
            for (strip, c_rows) in output.as_mut_slice().chunks_mut(MR * n).enumerate() {
                pack_a(lhs.as_slice(), n, strip * MR, pc, kc, &mut packed_a);
                multiply_strip(&packed_a, &packed_b, n, c_rows);
            }
        }
    }
}

// GEMM compute shaders for the `metal-naive` and `metal-tiled` kernels.
// Compiled from source at runtime by `shader.rs`; each kernel is a template
// instantiated below once per element type, named gemm_<shader>_<type>.
//
// All matrices are n×n, row-major. Buffers: 0 = A, 1 = B, 2 = C; n at 3.
// The accumulator is T, so half sums in half, the same as the CPU kernels.

#include <metal_stdlib>
using namespace metal;

// One thread per output element. gid.x is the column j and gid.y the row i,
// so neighbouring threads read neighbouring B[k*n + j] and share A[i*n + k].
template <typename T>
kernel void gemm_naive(device const T* a [[buffer(0)]],
                       device const T* b [[buffer(1)]],
                       device T* c [[buffer(2)]],
                       constant uint& n [[buffer(3)]],
                       uint2 gid [[thread_position_in_grid]]) {
    if (gid.x >= n || gid.y >= n) return;
    T acc = 0;
    for (uint k = 0; k < n; ++k) {
        acc += a[gid.y * n + k] * b[k * n + gid.x];
    }
    c[gid.y * n + gid.x] = acc;
}

template [[host_name("gemm_naive_half")]] kernel void gemm_naive<half>(
    device const half*, device const half*, device half*, constant uint&, uint2);
template [[host_name("gemm_naive_float")]] kernel void gemm_naive<float>(
    device const float*, device const float*, device float*, constant uint&, uint2);
template [[host_name("gemm_naive_int")]] kernel void gemm_naive<int>(
    device const int*, device const int*, device int*, constant uint&, uint2);
template [[host_name("gemm_naive_long")]] kernel void gemm_naive<long>(
    device const long*, device const long*, device long*, constant uint&, uint2);

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

// Must equal TILE in shader.rs, which dispatches TS×TS threadgroups.
constant constexpr uint TS = 16;

// Each TS×TS threadgroup computes one TS×TS block of C. Per step it stages
// one tile of A and one of B in threadgroup memory, so every device-memory
// element is read once per threadgroup instead of once per thread.
template <typename T>
kernel void gemm_tiled(device const T* a [[buffer(0)]],
                       device const T* b [[buffer(1)]],
                       device T* c [[buffer(2)]],
                       constant uint& n [[buffer(3)]],
                       uint2 gid [[thread_position_in_grid]],
                       uint2 lid [[thread_position_in_threadgroup]]) {
    threadgroup T a_tile[TS][TS];
    threadgroup T b_tile[TS][TS];
    T acc = 0;
    // No early return for threads past the edge: they must still load (zeros)
    // and reach every barrier, or the threadgroup's behaviour is undefined.
    for (uint t = 0; t < n; t += TS) {
        uint a_col = t + lid.x;
        uint b_row = t + lid.y;
        a_tile[lid.y][lid.x] = (gid.y < n && a_col < n) ? a[gid.y * n + a_col] : T(0);
        b_tile[lid.y][lid.x] = (b_row < n && gid.x < n) ? b[b_row * n + gid.x] : T(0);
        threadgroup_barrier(mem_flags::mem_threadgroup);
        for (uint k = 0; k < TS; ++k) {
            acc += a_tile[lid.y][k] * b_tile[k][lid.x];
        }
        // Nobody overwrites a tile until every thread has finished reading it.
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    if (gid.x < n && gid.y < n) {
        c[gid.y * n + gid.x] = acc;
    }
}

template [[host_name("gemm_tiled_half")]] kernel void gemm_tiled<half>(
    device const half*, device const half*, device half*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_float")]] kernel void gemm_tiled<float>(
    device const float*, device const float*, device float*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_int")]] kernel void gemm_tiled<int>(
    device const int*, device const int*, device int*, constant uint&, uint2, uint2);
template [[host_name("gemm_tiled_long")]] kernel void gemm_tiled<long>(
    device const long*, device const long*, device long*, constant uint&, uint2, uint2);

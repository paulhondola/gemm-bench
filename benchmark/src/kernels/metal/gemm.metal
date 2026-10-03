// GEMM compute shaders for the `metal-naive`, `metal-tiled` and `metal-simdgroup` kernels.
// Compiled from source at runtime by `shader.rs`; each kernel is a template
// instantiated below once per element type, named gemm_<shader>_<type>.
//
// All matrices are n×n, row-major. Buffers: 0 = A, 1 = B, 2 = C; n at 3.
// The accumulator is T, so half sums in half, the same as the CPU kernels.

#include <metal_stdlib>
#include <metal_simdgroup_matrix>
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

// Must equal BLOCK_ROWS, BLOCK_COLS, DEPTH_STEP and SIMDGROUPS in shader.rs.
constant constexpr uint BM = 32;  // rows of C per threadgroup
constant constexpr uint BN = 32;  // columns of C per threadgroup
constant constexpr uint BK = 16;  // depth of each staged step
constant constexpr uint SG = 4;   // simdgroups per threadgroup, arranged 2×2
constant constexpr uint THREADS = SG * 32;
constant constexpr uint SM = BM / 2;  // rows of C per simdgroup
constant constexpr uint SN = BN / 2;  // columns of C per simdgroup
constant constexpr uint FM = SM / 8;  // 8×8 fragments per simdgroup, down
constant constexpr uint FN = SN / 8;  // and across
// A's strip then B's, per staged step.
constant constexpr uint STRIPS = BM * BK + BK * BN;
// One buffer, reused: the strips while multiplying, C while storing.
constant constexpr uint STAGE = STRIPS > BM * BN ? STRIPS : BM * BN;
// 4-element groups of A's and B's strips each thread stages per step.
constant constexpr uint A_GROUPS = BM * BK / (THREADS * 4);
constant constexpr uint B_GROUPS = BK * BN / (THREADS * 4);

// This thread's share of one step's strips, held in registers.
template <typename T>
struct Strips {
    vec<T, 4> a[A_GROUPS];
    vec<T, 4> b[B_GROUPS];
};

// Reads this thread's share of the strips at depth t, zero past the edge.
// Groups never straddle a row, since BK and BN are multiples of 4.
template <typename T>
inline Strips<T> load_strips(device const T* a, device const T* b, uint n,
                             uint row0, uint col0, uint t, ushort tid) {
    Strips<T> s;
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = row0 + e / BK, col = t + e % BK;
        for (uint r = 0; r < 4; ++r) {
            s.a[q][r] = (row < n && col + r < n) ? a[row * n + col + r] : T(0);
        }
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = t + e / BN, col = col0 + e % BN;
        for (uint r = 0; r < 4; ++r) {
            s.b[q][r] = (row < n && col + r < n) ? b[row * n + col + r] : T(0);
        }
    }
    return s;
}

// Writes this thread's share of the strips into a stage: A as [BM][BK], then B as [BK][BN].
template <typename T>
inline void store_strips(thread const Strips<T>& s, threadgroup T* stage, ushort tid) {
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        for (uint r = 0; r < 4; ++r) {
            stage[e + r] = s.a[q][r];
        }
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = BM * BK + (tid + q * THREADS) * 4;
        for (uint r = 0; r < 4; ++r) {
            stage[e + r] = s.b[q][r];
        }
    }
}

// Each threadgroup of SG simdgroups computes one BM×BN block of C, and each
// simdgroup holds an SM×SN quarter of it as FM×FN 8×8 simdgroup_matrix
// accumulators. Per step the threadgroup stages A's BM×BK strip and B's BK×BN
// strip in threadgroup memory, zero past the edge as in gemm_tiled, then each
// simdgroup multiplies 8×8 fragments out of them.
template <typename T>
kernel void gemm_simdgroup(device const T* a [[buffer(0)]],
                           device const T* b [[buffer(1)]],
                           device T* c [[buffer(2)]],
                           constant uint& n [[buffer(3)]],
                           uint2 group [[threadgroup_position_in_grid]],
                           ushort tid [[thread_index_in_threadgroup]],
                           ushort sg [[simdgroup_index_in_threadgroup]]) {
    threadgroup T stage[STAGE];
    threadgroup T* a_stage = stage;            // [BM][BK]
    threadgroup T* b_stage = stage + BM * BK;  // [BK][BN]
    const uint row0 = group.y * BM;
    const uint col0 = group.x * BN;
    const uint sg_row = (sg / 2) * SM;
    const uint sg_col = (sg % 2) * SN;

    simdgroup_matrix<T, 8, 8> acc[FM][FN];
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            acc[i][j] = make_filled_simdgroup_matrix<T, 8, 8>(T(0));
        }
    }

    // No early return for blocks past the edge: every thread must reach every
    // barrier, so out-of-range elements load as zeros instead.
    for (uint t = 0; t < n; t += BK) {
        store_strips(load_strips(a, b, n, row0, col0, t, tid), stage, tid);
        threadgroup_barrier(mem_flags::mem_threadgroup);
        #pragma clang loop unroll(full)
        for (uint kk = 0; kk < BK; kk += 8) {
            simdgroup_matrix<T, 8, 8> a_frag[FM];
            simdgroup_matrix<T, 8, 8> b_frag[FN];
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                simdgroup_load(a_frag[i], a_stage + (sg_row + i * 8) * BK + kk, BK);
            }
            #pragma clang loop unroll(full)
            for (uint j = 0; j < FN; ++j) {
                simdgroup_load(b_frag[j], b_stage + kk * BN + sg_col + j * 8, BN);
            }
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                #pragma clang loop unroll(full)
                for (uint j = 0; j < FN; ++j) {
                    simdgroup_multiply_accumulate(acc[i][j], a_frag[i], b_frag[j], acc[i][j]);
                }
            }
        }
        // Nobody overwrites the stage until every simdgroup has finished reading it.
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }

    // ponytail: every block stores through threadgroup memory, so edge blocks
    // need no second path; simdgroup_store straight to c for blocks wholly
    // inside n×n if the store ever shows up in a profile.
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            simdgroup_store(acc[i][j], stage + (sg_row + i * 8) * BN + sg_col + j * 8, BN);
        }
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint e = tid; e < BM * BN; e += THREADS) {
        uint row = row0 + e / BN, col = col0 + e % BN;
        if (row < n && col < n) {
            c[row * n + col] = stage[e];
        }
    }
}

template [[host_name("gemm_simdgroup_half")]] kernel void gemm_simdgroup<half>(
    device const half*, device const half*, device half*, constant uint&, uint2, ushort, ushort);
template [[host_name("gemm_simdgroup_float")]] kernel void gemm_simdgroup<float>(
    device const float*, device const float*, device float*, constant uint&, uint2, ushort, ushort);

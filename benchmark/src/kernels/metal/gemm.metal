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
constant constexpr uint BM = 64;  // rows of C per threadgroup
constant constexpr uint BN = 64;  // columns of C per threadgroup
constant constexpr uint BK = 16;  // depth of each staged step
constant constexpr uint SG = 4;   // simdgroups per threadgroup, arranged 2×2
constant constexpr uint THREADS = SG * 32;
constant constexpr uint SM = BM / 2;  // rows of C per simdgroup
constant constexpr uint SN = BN / 2;  // columns of C per simdgroup
constant constexpr uint FM = SM / 8;  // 8×8 fragments per simdgroup, down
constant constexpr uint FN = SN / 8;  // and across
static_assert(SG == 4 && BM % 16 == 0 && BN % 16 == 0 && BK % 8 == 0,
              "the 2×2 simdgroup grid needs 8×8-fragment-aligned blocks");
// Staged rows are padded by 16 bytes, as MLX's steel GEMM does, so the 8 rows
// of a fragment don't all start on the same threadgroup-memory banks.
template <typename T> constant constexpr uint LDA = BK + 16 / sizeof(T);  // A's staged row stride
template <typename T> constant constexpr uint LDB = BN + 16 / sizeof(T);  // B's
// A's strip then B's, per staged step.
template <typename T> constant constexpr uint STRIPS = BM * LDA<T> + BK * LDB<T>;
// 4-element groups of A's and B's strips each thread stages per step.
constant constexpr uint A_GROUPS = BM * BK / (THREADS * 4);
constant constexpr uint B_GROUPS = BK * BN / (THREADS * 4);
static_assert(BM * BK % (THREADS * 4) == 0 && BK * BN % (THREADS * 4) == 0,
              "every thread stages whole 4-element groups");

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
    // Both strips wholly inside n×n, and every row aligned for a `vec<T, 4>`
    // load: one vector load per group instead of four guarded scalar loads.
    const bool inside = n % 4 == 0 && row0 + BM <= n && col0 + BN <= n && t + BK <= n;
    Strips<T> s;
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = row0 + e / BK, col = t + e % BK;
        if (inside) {
            s.a[q] = *reinterpret_cast<device const vec<T, 4>*>(a + row * n + col);
        } else {
            for (uint r = 0; r < 4; ++r) {
                s.a[q][r] = (row < n && col + r < n) ? a[row * n + col + r] : T(0);
            }
        }
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = t + e / BN, col = col0 + e % BN;
        if (inside) {
            s.b[q] = *reinterpret_cast<device const vec<T, 4>*>(b + row * n + col);
        } else {
            for (uint r = 0; r < 4; ++r) {
                s.b[q][r] = (row < n && col + r < n) ? b[row * n + col + r] : T(0);
            }
        }
    }
    return s;
}

// Writes this thread's share of the strips into a 16-byte-aligned stage: A as
// [BM][LDA], then B as [BK][LDB]. Every group's offset is a multiple of its own
// size (16 bytes at float, 8 at half), so each is one aligned vector store.
template <typename T>
inline void store_strips(thread const Strips<T>& s, threadgroup T* stage, ushort tid) {
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        *reinterpret_cast<threadgroup vec<T, 4>*>(stage + e / BK * LDA<T> + e % BK) = s.a[q];
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        *reinterpret_cast<threadgroup vec<T, 4>*>(stage + BM * LDA<T> + e / BN * LDB<T> + e % BN) = s.b[q];
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
                           ushort sg [[simdgroup_index_in_threadgroup]],
                           ushort lane [[thread_index_in_simdgroup]]) {
    alignas(16) threadgroup T stage[STRIPS<T>];
    threadgroup T* a_stage = stage;                // [BM][LDA]
    threadgroup T* b_stage = stage + BM * LDA<T>;  // [BK][LDB]
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
                simdgroup_load(a_frag[i], a_stage + (sg_row + i * 8) * LDA<T> + kk, LDA<T>);
            }
            #pragma clang loop unroll(full)
            for (uint j = 0; j < FN; ++j) {
                simdgroup_load(b_frag[j], b_stage + kk * LDB<T> + sg_col + j * 8, LDB<T>);
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

    // Interior fragments go straight from registers to C. A fragment that
    // crosses the edge goes through this simdgroup's own 8×8 slice of the
    // stage, free since the k-loop's last barrier, and only its in-range
    // elements are written.
    threadgroup T* edge = stage + sg * 64;
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            const uint frag_row = row0 + sg_row + i * 8;
            const uint frag_col = col0 + sg_col + j * 8;
            if (frag_row + 8 <= n && frag_col + 8 <= n) {
                simdgroup_store(acc[i][j], c + frag_row * n + frag_col, n);
            } else {
                simdgroup_store(acc[i][j], edge, 8);
                simdgroup_barrier(mem_flags::mem_threadgroup);
                for (uint e = lane; e < 64; e += 32) {
                    uint row = frag_row + e / 8, col = frag_col + e % 8;
                    if (row < n && col < n) {
                        c[row * n + col] = edge[e];
                    }
                }
                // The next edge fragment reuses the slice.
                simdgroup_barrier(mem_flags::mem_threadgroup);
            }
        }
    }
}

template [[host_name("gemm_simdgroup_half")]] kernel void gemm_simdgroup<half>(
    device const half*, device const half*, device half*, constant uint&, uint2, ushort, ushort, ushort);
template [[host_name("gemm_simdgroup_float")]] kernel void gemm_simdgroup<float>(
    device const float*, device const float*, device float*, constant uint&, uint2, ushort, ushort, ushort);

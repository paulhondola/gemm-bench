The Apple Silicon GPU, programmed through Metal. The CPU and GPU share memory, but each run still copies the inputs into GPU buffers and the result back out, and that copying is timed along with the GPU's work.

## `mps`

Apple's tuned GPU matrix multiply, `MPSMatrixMultiplication` from Metal Performance Shaders.

```text
copy A, B into shared GPU buffers
multiply = MPSMatrixMultiplication(N, N, N, alpha: 1, beta: 0)
multiply.encode(commandBuffer, A, B, C)
commit and wait
copy C back out
```

- **Runs via:** Metal's Objective-C API, called from Rust through the `objc2` bindings.
- **Tunes:** Nothing.
- **Precisions:** `f16`, `f32`. Apple GPUs have no `f64`.
- **Watch for:** It runs on the GPU, not the AMX: the AMX is only reachable from the CPU, through Accelerate.
- **Source:** [`benchmark/src/kernels/metal/mps.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/metal/mps.rs)

## `metal-naive`

A hand-written GPU program (a compute shader) that runs one GPU thread per output value. Each thread reads its row of A and its column of B straight from GPU memory; neighbouring threads read neighbouring values of B.

```text
# one GPU thread per (i, j)
acc = 0
for k in 0..N:
  acc += A[i][k] * B[k][j]
C[i][j] = acc
```

- **Runs via:** `gemm.metal`, compiled from source at run time and dispatched through Metal.
- **Tunes:** Nothing.
- **Precisions:** `f16`, `f32`, `i32`, `i64` (Metal's `half`, `float`, `int`, `long`; Apple GPUs have no `double`).
- **Watch for:** It adds up in the element type, like the CPU kernels. Apple GPUs emulate 64-bit integer multiplies in software, so `i64` is much slower than `i32`.
- **Source:** [`benchmark/src/kernels/metal/gemm.metal`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/metal/gemm.metal)

## `metal-tiled`

The same shader file, tiled: each 16 × 16 group of GPU threads loads a tile of A and one of B into fast on-chip memory (threadgroup memory) and shares them. Each value is then fetched from GPU memory once per group instead of once per thread.

```text
# one GPU thread per (i, j), in 16 × 16 groups
acc = 0
for t in 0..N step 16:
  tileA[y][x] = A[i][t + x];  tileB[y][x] = B[t + y][j]
  barrier                     # the group's loads are done
  for k in 0..16:
    acc += tileA[y][k] * tileB[k][x]
  barrier                     # the group's reads are done
C[i][j] = acc
```

- **Runs via:** The same as `metal-naive`.
- **Tunes:** Nothing: the 16 × 16 tile is fixed, so no knob applies.
- **Precisions:** `f16`, `f32`, `i32`, `i64`.
- **Watch for:** At `i64` it runs slower than `metal-naive`. The emulated 64-bit multiplies make the work compute-bound, so tiling saves no memory traffic that matters, while each step still pays for two barriers.
- **Source:** [`benchmark/src/kernels/metal/gemm.metal`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/metal/gemm.metal)

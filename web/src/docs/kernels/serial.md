One core. These kernels do the same arithmetic in different orders, so they show what the order of memory accesses is worth on its own.

## `naive-ijk`

The textbook triple loop: each output value is a row of A times a column of B. Walking down a column of B jumps a whole row ahead in memory at every step, so almost every read misses the cache. It's the baseline the optimization ladder and the CPU & AMX speedups start from.

```text
for i in 0..N:
  for j in 0..N:
    sum = 0
    for k in 0..N:
      sum += A[i][k] * B[k][j]    # down a column of B: N elements apart
    C[i][j] = sum
```

- **Runs via:** Plain Rust loops on one core.
- **Tunes:** Nothing.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Source:** [`benchmark/src/kernels/serial/naive.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/naive.rs)

## `ikj`

The same arithmetic with the two inner loops swapped. The innermost loop now walks along a row of B and a row of C, which sit next to each other in memory, so reads come from cache and the compiler can process several values per instruction (SIMD).

```text
C = 0
for i in 0..N:
  for k in 0..N:
    a = A[i][k]
    for j in 0..N:
      C[i][j] += a * B[k][j]      # along rows of B and C
```

- **Runs via:** Plain Rust on one core, vectorized by the compiler (NEON on Apple Silicon).
- **Tunes:** Nothing.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** It is also the reference: every run checks each kernel's output against `ikj`'s and stops if the error is too large.
- **Source:** [`benchmark/src/kernels/serial/ikj.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/ikj.rs)

## `tiled`

`ikj`, working through the matrices in square tiles whose edge is the block size, so the parts of A, B and C in use stay in the L1/L2 cache while they're reused.

```text
C = 0
for ii, kk, jj in steps of b:     # b = block size
  for i in ii..ii+b:
    for k in kk..kk+b:
      a = A[i][k]
      for j in jj..jj+b:
        C[i][j] += a * B[k][j]
```

- **Runs via:** Plain Rust on one core, at each block size measured.
- **Tunes:** Block size.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** The best block size depends on the precision and the matrix size; the Block size tab compares them.
- **Source:** [`benchmark/src/kernels/serial/tiled.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/tiled.rs)

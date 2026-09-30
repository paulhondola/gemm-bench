One core. `naive-ijk`, `ikj` and `tiled` do the same arithmetic in different orders, so they show what the order of memory accesses is worth on its own; `packed` shows what register blocking and explicit SIMD add on top.

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

## `packed`

The GotoBLAS/BLIS design. For each k-block, B is copied into narrow k-major strips and each 8-row strip of A into a k-major buffer. A `std::simd` micro-kernel then keeps an 8 × 3-vector block of C in registers for the whole k-block and adds it into C once. `ikj` loads and stores C for every multiply-add, which caps it near a third of peak; here C stays in registers, so the multiply-add units become the limit.

```text
C = 0
for kk in steps of b:                    # b = block size: the k-block depth
  pack B[kk..kk+b][*] into strips 3 vectors wide
  for each 8-row strip i of C:
    pack A[i..i+8][kk..kk+b]
    for each B strip j:
      acc = 0                            # 8 × 3 vectors, in registers
      for k in kk..kk+b:
        acc += A[i..i+8][k] ⊗ B[k][j]    # 24 fused multiply-adds
      C[i..i+8][j] += acc
```

- **Runs via:** Portable SIMD (`std::simd`) on one core: one 128-bit NEON register per vector, with fused multiply-add for floats.
- **Tunes:** Block size, as the depth of each packed k-block.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** `i64` gains little: NEON has no 64-bit integer multiply, so each lane multiplies in a scalar register. Floats round once per multiply-add instead of twice, so results differ slightly from `ikj`'s.
- **Source:** [`benchmark/src/kernels/serial/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/packed.rs), with the shared packing and micro-kernel in [`benchmark/src/kernels/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/packed.rs)

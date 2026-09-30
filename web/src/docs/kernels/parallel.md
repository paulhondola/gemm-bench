The same loops spread over several cores. The kernels differ in how they hand out the work: Rayon's work stealing balances it while the kernel runs, and the static schedule fixes it up front.

## `rayon-ikj`

`ikj` with the output rows shared out by Rayon. Threads that finish early take rows from busy ones (work stealing), so fast and slow cores both stay busy.

```text
parallel for i in 0..N:          # Rayon splits the rows; idle threads steal
  for k in 0..N:
    a = A[i][k]
    for j in 0..N:
      C[i][j] += a * B[k][j]
```

- **Runs via:** A Rayon parallel iterator, on a thread pool of the measured size that is built before timing starts.
- **Tunes:** Thread count.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Source:** [`benchmark/src/kernels/rayon/ikj.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/rayon/ikj.rs)

## `rayon-tiled`

Rows grouped into chunks, at least four per thread and never taller than one tile, each computed in tiles like `tiled`. Work stealing balances the chunks across threads, and the spare chunks let it route around a slow core.

```text
split the rows into chunks: ≥ 4 per thread, ≤ b rows each
parallel for chunk in chunks:    # Rayon work stealing
  for kk, jj in steps of b:
    for i in chunk:
      for k in kk..kk+b:
        for j in jj..jj+b:
          C[i][j] += A[i][k] * B[k][j]
```

- **Runs via:** A Rayon parallel iterator over the row chunks, on a pool built before timing starts.
- **Tunes:** Thread count and block size.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Source:** [`benchmark/src/kernels/rayon/tiled.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/rayon/tiled.rs)

## `rayon-packed`

`packed`, with its 8-row strips of C spread across threads by Rayon work stealing. Each k-block's B panel is packed once, on the calling thread, and shared read-only by every worker; each worker packs its own strips of A.

```text
C = 0
for kk in steps of b:
  pack B[kk..kk+b][*] into strips       # once, shared
  parallel for each 8-row strip i:      # Rayon work stealing
    pack A[i..i+8][kk..kk+b]
    for each B strip j:
      C[i..i+8][j] += micro-kernel(A strip, B strip)
```

- **Runs via:** A Rayon parallel iterator over the 8-row strips, on a pool built before timing starts, with the `packed` micro-kernel on each core.
- **Tunes:** Thread count and block size (the k-block depth).
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** B is packed on one thread between parallel rounds: an estimated 8% of an 8-thread run at N = 2048 and about a quarter at N = 512, so its speedup over `packed` shrinks at small N. There are also few strips to share there: N / 8, so 8 at N = 64.
- **Source:** [`benchmark/src/kernels/rayon/packed.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/rayon/packed.rs)

## `static-ikj`

Rows split into equal consecutive ranges up front, one per thread, like OpenMP's `schedule(static)`. Nothing is rebalanced, so there's no scheduling overhead, but the run lasts as long as its slowest thread.

```text
rows per thread = N / T          # the first N mod T threads get one more
on every thread at once:         # one broadcast, one fixed range each
  for i in my rows:
    for k in 0..N:
      a = A[i][k]
      for j in 0..N:
        C[i][j] += a * B[k][j]
```

- **Runs via:** A persistent Rayon thread pool used without stealing: one broadcast hands every thread its fixed range.
- **Tunes:** Thread count.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** Every thread needs at least one row, so a thread count above N is skipped.
- **Source:** [`benchmark/src/kernels/static_threads/ikj.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/static_threads/ikj.rs)

## `static-tiled`

The same fixed split, computed in tiles inside each thread's range.

```text
on every thread at once:
  for ii in my rows, in steps of b:
    for kk, jj in steps of b:
      for i in ii..ii+b, k in kk..kk+b, j in jj..jj+b:
        C[i][j] += A[i][k] * B[k][j]
```

- **Runs via:** The same pool and broadcast as `static-ikj`.
- **Tunes:** Thread count and block size.
- **Precisions:** `f16`, `f32`, `f64`, `i32`, `i64`.
- **Watch for:** As for `static-ikj`, a thread count above N is skipped.
- **Source:** [`benchmark/src/kernels/static_threads/tiled.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/static_threads/tiled.rs)

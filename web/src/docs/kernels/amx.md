A matrix unit beside the CPU cores. Apple doesn't document its instructions, so the only way to use it is through Apple's Accelerate library, which also decides how many threads to use.

## `accelerate-blas`

Apple's BLAS matrix multiply, `sgemm` for `f32` and `dgemm` for `f64`. On Apple Silicon, Accelerate's matrix routines run on the AMX.

```text
cblas_sgemm(RowMajor, NoTrans, NoTrans, N, N, N,
            1.0, A, N, B, N, 0.0, C, N)     # C = 1·A·B + 0·C
```

- **Runs via:** A C function call from Rust into Apple's Accelerate framework.
- **Tunes:** Nothing: Accelerate picks its own threading.
- **Precisions:** `f32`, `f64`. BLAS has no half-precision or integer matrix multiply.
- **Watch for:** Its rows record one thread, meaning one calling thread; Accelerate may use more cores internally.
- **Source:** [`benchmark/src/kernels/accelerate/accelerate_blas.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/accelerate/accelerate_blas.rs)

## `accelerate-bnns`

The same AMX through BNNSGraph, Apple's machine-learning graph API: a one-operation matmul graph, compiled once per matrix size before timing starts.

```text
# once per size, before timing (Swift)
graph = makeContext { a, b in a.matmul(b) }
# every timed call
graph.execute(C, A, B)
```

- **Runs via:** Rust calls a small Swift package, because the BNNSGraph builder is Swift-only (macOS 26+). The package calls Accelerate.
- **Tunes:** Nothing: Accelerate picks its own threading.
- **Precisions:** `f16`, `f32`. BNNSGraph has no `f64`, and integer matmul graphs compile but don't run.
- **Watch for:** At `f16` it also adds up in `f16`, so it is fast but loses accuracy as N grows. Its rows record one calling thread, as for `accelerate-blas`.
- **Source:** [`benchmark/src/kernels/accelerate/accelerate_bnns.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/accelerate/accelerate_bnns.rs) and [`benchmark/swift/BnnsGraph`](https://github.com/paulhondola/gemm-bench/tree/main/benchmark/swift/BnnsGraph)

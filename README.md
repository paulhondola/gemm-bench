# rayon-gemm

Safe Rust benchmarks for dense, row-major square matrix multiplication at
`f16`, `f32`, or `f64` precision. The suite includes canonical `i-j-k`,
cache-friendly `i-k-j`, blocked, Rayon work-stealing, and deterministic
scoped-thread static-scheduling kernels.

The crate builds on nightly Rust (pinned by `rust-toolchain.toml`) because the
`f16` primitive is not yet stable. On AArch64 CPUs with FP16 support, such as
Apple Silicon, `f16` kernels compile to native half-precision instructions.

Run a small CSV sweep:

```sh
cargo run --release -- \
  --sizes 256,512 --threads 1,2,4,8 \
  --kernel ikj,rayon-ikj,static-ikj \
  --precision f32,f64 \
  --repetitions 5 --output results.csv
```

Omit `--sizes`, `--threads`, and `--kernel` to use the full default sweep.
The default sizes are `64,128,256,512,1024,2048`; worker counts are powers of
two through `available_parallelism()`. Sequential kernels are recorded once at
one thread, while parallel kernels are swept over the requested worker counts.
`--precision` accepts any of `f16,f32,f64` and defaults to `f32` only.

CSV records have the stable visualization-pipeline columns:
`kernel,n,threads,precision,elapsed_ms,gflops`. The `--output` extension
selects the format: use `.csv` for CSV or `.json` for a JSON array. Other
extensions are rejected.

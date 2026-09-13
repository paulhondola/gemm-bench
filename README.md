# rayon-gemm

Safe Rust benchmarks for dense, row-major `f64` square matrix multiplication.
The suite includes canonical `i-j-k`, cache-friendly `i-k-j`, blocked, Rayon
work-stealing, and deterministic scoped-thread static-scheduling kernels.

Run a small CSV sweep:

```sh
cargo run --release -- \
  --sizes 256,512 --threads 1,2,4,8 \
  --kernel ikj,rayon-ikj,static-ikj \
  --repetitions 5 --output results.csv
```

Omit `--sizes`, `--threads`, and `--kernel` to use the full default sweep.
The default sizes are `64,128,256,512,1024,2048`; worker counts are powers of
two through `available_parallelism()`. Sequential kernels are recorded once at
one thread, while parallel kernels are swept over the requested worker counts.

CSV records have the stable visualization-pipeline columns:
`kernel,n,threads,elapsed_ms,gflops`. Use `--format json` to write the same
records as a JSON array instead.

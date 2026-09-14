# rayon-gemm

High-performance, safe Rust benchmarks for dense, row-major square matrix multiplication ($C = A \times B$) across CPU and Apple Silicon GPU backends at `f16`, `f32`, and `f64` precisions.

---

## What It Does

`rayon-gemm` measures and compares matrix multiplication performance across multiple architectural approaches, memory access patterns, and execution backends:

### 1. CPU Kernels

| Kernel | Algorithm / Strategy | Key Characteristics |
| :--- | :--- | :--- |
| `naive-ijk` | Canonical 3-loop order ($i \to j \to k$) | Column-strided access into matrix $B$; poor cache locality; baseline reference. |
| `ikj` | Loop interchange ($i \to k \to j$) | Row-wise contiguous streaming in $B$ and $C$; autovectorizes with SIMD instructions. |
| `tiled` | 2D Cache blocking ($B \times B$ tiles) | Partitions working sets into tiles sized for CPU L1/L2 data caches. |
| `rayon-ikj` | Rayon work-stealing parallel iterator | Dynamically distributes row chunks across a Rayon worker thread pool with `ikj` compute. |
| `rayon-tiled` | Rayon parallel 2D tiled iterator | Work-stealing scheduling over 2D matrix tiles. |
| `static-ikj` | OpenMP-style persistent thread pool | Partitions contiguous row chunks evenly across dedicated threads, eliminating work-stealing overhead. |

### 2. Apple Silicon GPU Kernels (Metal & MPS)

On macOS / Apple Silicon devices, `rayon-gemm` benchmarks unified zero-copy GPU matrix multiplication:

* **Custom Tiled Metal Shader (Naive / Custom Compute Kernel)**:
  - Custom Metal Shading Language (MSL) shader (`matmul.metal`).
  - Employs shared `threadgroup` memory tiles (`tileA`, `tileB`) and `threadgroup_barrier` synchronization to reduce global unified memory bandwidth demands.
  - Demonstrates raw compute pipeline dispatch via Metal command encoders.
* **Metal Performance Shaders (MPS / Hardware Library)**:
  - Apple's production-grade accelerated BLAS implementation using `MPSMatrixMultiplication` from the `MetalPerformanceShaders` framework.
  - Directly engages Apple Silicon matrix coprocessors (AMX) and GPU hardware execution units for near-peak theoretical TFLOPS.

---

## Prerequisites & Installation

The benchmark suite requires **Rust Nightly** because the `f16` primitive type (`#![feature(f16)]`) is not yet stabilized. On AArch64 CPUs with FP16 support (such as Apple Silicon M-series), `f16` operations compile to native hardware half-precision instructions.

1. Install the nightly toolchain:
   ```sh
   rustup toolchain install nightly
   ```
   *(Note: The repository includes a `rust-toolchain.toml` that automatically selects the appropriate toolchain).*

2. Build the project in release mode:
   ```sh
   cargo build --release
   ```

---

## Usage & Run Commands

### 1. Default Benchmark Sweep

Running without flags performs a full sweep across all default sizes (`64, 128, 256, 512, 1024, 2048`), all CPU kernels, and powers-of-two thread counts up to `available_parallelism()` at `f32` precision:

```sh
cargo run --release -- --output results.csv
```

### 2. Targeted Sweeps

#### Compare Cache Locality (Single-Threaded)
Compare the canonical `naive-ijk`, cache-friendly `ikj`, and cache-blocked `tiled` kernels:
```sh
cargo run --release -- \
  --sizes 128,256,512,1024 \
  --kernel naive,ikj,tiled \
  --output cache_comparison.csv
```

#### Parallel Scaling Sweep
Benchmark multi-threaded scaling between Rayon work-stealing and static OS threads:
```sh
cargo run --release -- \
  --sizes 512,1024,2048 \
  --threads 1,2,4,8,10 \
  --kernel rayon-ikj,static-ikj \
  --repetitions 5 \
  --output parallel_scaling.csv
```

#### Multi-Precision Sweep (`f16`, `f32`, `f64`)
Evaluate throughput across data types:
```sh
cargo run --release -- \
  --sizes 512,1024 \
  --kernel ikj,rayon-ikj \
  --precision f16,f32,f64 \
  --output precisions.csv
```

#### Headless / CI Execution (No Progress Bar)
Suppress the animated progress bar to ensure clean log output in automated environments:
```sh
cargo run --release -- \
  --sizes 256,512 \
  --kernel ikj,rayon-ikj \
  --no-progress \
  --output results.json
```

---

## CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--sizes <N,...>` | Matrix dimensions (square $N \times N$), comma-delimited | `64,128,256,512,1024,2048` |
| `--threads <T,...>` | Worker thread counts for parallel kernels | Powers of 2 up to CPU count |
| `--kernel <K,...>` | Kernel(s) to benchmark (`naive`, `ikj`, `tiled`, `rayon-ikj`, `rayon-tiled`, `static-ikj`) | All kernels |
| `--precision <P,...>` | Precision(s) to benchmark (`f16`, `f32`, `f64`) | `f32` |
| `--repetitions <R>` | Timed iterations measured per configuration (mean is recorded) | `1` |
| `--block-size <B>` | Tile edge length for blocked kernels | `64` |
| `--no-progress` | Disables the interactive `indicatif` progress bar | `false` |
| `--output <PATH>` | **(Required)** Path for output (`.csv` or `.json`) | — |

---

## Methodology & Output Schema

1. **Warmup Run**: Every configuration executes one untimed warmup pass prior to measurement, isolating thread pool initialization, cold caches, and dynamic loader overhead from the recorded metrics.
2. **Work Validation**: `static-ikj` requires at least one matrix row per worker thread; thread counts exceeding the matrix dimension $N$ are rejected upfront.
3. **Structured Export**:
   - The `--output` file extension automatically selects the format: `.csv` or `.json`.
   - Records follow the standard schema:
     $$\text{GFLOPS} = \frac{2 \times N^3}{\text{elapsed\_seconds} \times 10^9}$$
   - Columns: `kernel, n, threads, precision, elapsed_ms, gflops`.

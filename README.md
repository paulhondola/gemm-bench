# rayon-gemm

High-performance, safe Rust benchmarks for dense, row-major square matrix multiplication ($C = A \times B$) across CPU and Apple Silicon GPU backends at `f16`, `f32`, `f64`, `i32`, and `i64` precisions, with a web dashboard for exploring the results.

---

## Repository Layout

| Path | Contents |
| :--- | :--- |
| [`benchmark/`](benchmark) | Rust crate `rayon-gemm`: the GEMM kernels and the benchmark CLI that produces the data. |
| [`web/`](web) | Bun + Vite + Svelte + TypeScript dashboard that queries the data in the browser with DuckDB-WASM. Deployed to GitHub Pages. |
| [`data/`](data) | Recorded benchmark runs (`f16`, `f32`, `f64`), each as `.csv` and `.json`. |
| [`justfile`](justfile) | Task runner for every build, run, lint, and check command. |
| [`lefthook.yml`](lefthook.yml) | Pre-commit hooks for both halves of the repo. |
| [`.github/workflows/`](.github/workflows) | CI (`ci.yml`) and dashboard deployment (`deploy.yml`). |

---

## Prerequisites

| Tool | Needed for | Install |
| :--- | :--- | :--- |
| [rustup](https://rustup.rs) | `benchmark/` | The pinned [`rust-toolchain.toml`](rust-toolchain.toml) selects **nightly** (with `clippy` and `rustfmt`) automatically, because the `f16` primitive (`#![feature(f16)]`) is not yet stable. |
| [just](https://github.com/casey/just) | All commands below | `brew install just` |
| [Bun](https://bun.sh) | `web/` | `curl -fsSL https://bun.sh/install \| bash` |
| [DuckDB CLI](https://duckdb.org) | `just data` | `brew install duckdb` |
| [lefthook](https://github.com/evilmartians/lefthook) | Optional pre-commit hooks | `brew install lefthook`, then `lefthook install` |

The `mps` GPU kernel requires macOS on Apple Silicon. Everything else runs on any platform supported by Rust nightly. On AArch64 CPUs with FP16 support (such as the Apple M series), `f16` arithmetic compiles to native half-precision instructions.

---

## Quick Start

```sh
git clone https://github.com/paulhondola/rayon-gemm.git
cd rayon-gemm
just build                # install and build all dependencies
just test                 # run the benchmark crate's test suite
just bench --sizes 256,512 --kernel ikj,rayon-ikj --output results
just dev                  # start the dashboard dev server
```

---

## Commands

Run `just` with no arguments to list every recipe.

| Command | What it runs | Use it to |
| :--- | :--- | :--- |
| `just bench [ARGS]` | `cargo run --release --manifest-path benchmark/Cargo.toml -- [ARGS]` | Run a benchmark sweep. Every argument is forwarded to the CLI (see [CLI Options](#cli-options)). `--output` is required. |
| `just build` | `cargo build --release` for `benchmark/`, then `bun run build` in `web/` | Produce the optimized benchmark binary (`benchmark/target/release/rayon-gemm`) and the static dashboard (`web/dist/`). |
| `just data` | `duckdb` CLI: `data/*.csv` → `web/public/results.parquet` | Rebuild the single Parquet file the dashboard queries. Columns are matched by name, so CSVs with new or missing columns merge cleanly. `just dev` and `just build` run it first. |
| `just dev` | `bun dev` in `web/` | Start the Vite dev server with hot reload for the dashboard. |
| `just test` | `cargo test --manifest-path benchmark/Cargo.toml` | Run kernel correctness tests (every kernel against `naive-ijk` at all precisions), CLI validation, and report tests. |
| `just lint` | `cargo fmt` for `benchmark/`, then `bun run lint` (Biome) in `web/`
| `just check` | `cargo clippy --all-targets -- -D warnings` for `benchmark/`, then `bun run typecheck` (`tsc --noEmit`) in `web/` | Run the static checks that CI enforces, without modifying files. For Svelte component type checking, run `bun run check` in `web/`. |

---

## Benchmark Kernels

### CPU

| Kernel | Algorithm / Strategy | Key Characteristics |
| :--- | :--- | :--- |
| `naive-ijk` | Canonical 3-loop order ($i \to j \to k$) | Column-strided access into matrix $B$; poor cache locality; baseline reference. |
| `ikj` | Loop interchange ($i \to k \to j$) | Row-wise contiguous streaming in $B$ and $C$; autovectorizes with SIMD instructions. |
| `tiled` | 2D cache blocking ($B \times B$ tiles) | Partitions working sets into tiles sized for CPU L1/L2 data caches. |
| `rayon-ikj` | Rayon work-stealing parallel iterator | Dynamically distributes row chunks across a Rayon worker thread pool with `ikj` compute. |
| `rayon-tiled` | Rayon parallel 2D tiled iterator | Work-stealing scheduling over 2D matrix tiles. |
| `static-ikj` | OpenMP-style persistent thread pool | Partitions contiguous row chunks evenly across dedicated threads, eliminating work-stealing overhead. |
| `static-tiled` | OpenMP-style thread pool with 2D blocking | Combines deterministic row partitioning on a persistent thread pool with L1/L2 cache-blocked compute. |

### Apple Silicon GPU (macOS only)

| Kernel | Backend | Key Characteristics |
| :--- | :--- | :--- |
| `mps` | `MPSMatrixMultiplication` (Metal Performance Shaders) | Runs on the GPU through unified-memory (`StorageModeShared`) buffers. Supports `f16` and `f32`; Apple GPUs have no `f64`. The timed region is GPU execution only (`commit` → `waitUntilCompleted`); buffer copies and command encoding are excluded. MPS does **not** use the AMX matrix coprocessor, which is only reachable from the CPU through Accelerate. |

---

## Running Benchmarks

### Default Sweep

Without flags, a run sweeps all default sizes (`64, 128, 256, 512, 1024, 2048, 4096`), every CPU kernel (plus `mps` on macOS), and powers-of-two thread counts up to `available_parallelism()` at `f32` precision:

```sh
just bench --output results
```

The full default sweep includes `naive-ijk` at $N = 4096$, which alone takes minutes. Narrow `--sizes` or `--kernel` for quick runs.

### Targeted Sweeps

#### Compare Cache Locality (Single-Threaded)

```sh
just bench \
  --sizes 128,256,512,1024 \
  --kernel naive,ikj,tiled \
  --output cache_comparison
```

#### Parallel Scaling

```sh
just bench \
  --sizes 512,1024,2048 \
  --threads 1,2,4,8,10 \
  --kernel rayon-ikj,static-ikj \
  --repetitions 5 \
  --output parallel_scaling
```

#### Multi-Precision (`f16`, `f32`, `f64`, `i32`, `i64`)

```sh
just bench \
  --sizes 512,1024 \
  --kernel ikj,rayon-ikj \
  --precision f16,f32,f64,i32,i64 \
  --output precisions
```

#### Apple Silicon GPU (MPS)

```sh
just bench \
  --sizes 256,512,1024,2048 \
  --kernel mps \
  --precision f16,f32 \
  --output mps_results
```

#### Headless / CI (No Progress Bar)

```sh
just bench \
  --sizes 256,512 \
  --kernel ikj,rayon-ikj \
  --no-progress \
  --output results
```

### CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--sizes <N,...>` | Matrix dimensions (square $N \times N$), comma-delimited | `64,128,256,512,1024,2048,4096` |
| `--threads <T,...>` | Worker thread counts for parallel kernels | Powers of 2 up to CPU count |
| `--kernel <K,...>` | Kernel(s) to benchmark (`naive`, `ikj`, `tiled`, `rayon-ikj`, `rayon-tiled`, `static-ikj`, `static-tiled`, `mps`) | All kernels supporting every requested precision (`mps` only on macOS, and omitted for `f64`, `i32`, `i64`) |
| `--precision <P,...>` | Precision(s) to benchmark (`f16`, `f32`, `f64`, `i32`, `i64`; `mps` supports only `f16` and `f32`) | `f32` |
| `--repetitions <R>` | Timed iterations measured per configuration (median, min, and standard deviation are recorded) | `5` |
| `--block-size <B>` | Tile edge length for blocked kernels | `64` |
| `--no-progress` | Disables the interactive `indicatif` progress bar | `false` |
| `--output <PREFIX>` | **(Required)** Path prefix without extension; writes both `<PREFIX>.csv` and `<PREFIX>.json` | — |

### Methodology & Output Schema

1. **Warmup Run**: Every configuration executes one untimed warmup pass before measurement, isolating thread pool initialization, cold caches, and dynamic loader overhead from the recorded metrics.
2. **Timing Statistics**: Each configuration runs `--repetitions` timed passes. Records carry the median, minimum, and sample standard deviation; `gflops` is derived from the median, which is robust to one-sided scheduler and thermal noise.
3. **Output Verification**: For each size and precision, serial `ikj` computes an untimed reference. After timing, every kernel's output is compared against it, and the run aborts (leaving existing output files untouched) if the largest element-wise relative error exceeds $4\sqrt{N}\,\varepsilon$, where $\varepsilon$ is the precision's machine epsilon. CPU kernels that sum in the same order as `ikj` match bit-for-bit; the slack covers kernels such as MPS that sum in a different order. Note that `f16` has $\varepsilon = 2^{-10}$, so its check (25% at $N = 4096$) catches broken kernels, not subtle rounding differences. Integers have $\varepsilon = 0$, so `i32`/`i64` outputs must match `ikj` exactly; integer inputs are the small integer numerators ($0$–$28$) rather than fractions, which keeps outputs far from overflow.
4. **Up-Front Validation**: Invalid plans fail before any work runs or any file is created. `static-ikj` and `static-tiled` need at least one matrix row per worker thread, `mps` rejects `f64`, `i32`, and `i64`, and `--output` must be a prefix, not a directory or a path with an extension.
5. **Structured Export**: Both output files are opened before the sweep but truncated only when results are written, so a failed run leaves earlier results intact.
   - Columns: `kernel, n, threads, precision, median_ms, min_ms, stddev_ms, gflops`.
   - `gflops` is $2N^3$ operations (floating-point or integer) per second (from the median time), in billions.

---

## Benchmark Data

Recorded full sweeps live in [`data/`](data):

| Files | Precision | Kernels |
| :--- | :--- | :--- |
| `data/f16.csv`, `data/f16.json` | `f16` | All CPU kernels + `mps` |
| `data/f32.csv`, `data/f32.json` | `f32` | All CPU kernels + `mps` |
| `data/f64.csv`, `data/f64.json` | `f64` | All CPU kernels |

---

## Web Dashboard

The dashboard in [`web/`](web) is a Vite + Svelte 5 + TypeScript app linted and formatted with [Biome](https://biomejs.dev).

- **Develop:** `just dev`, then open the URL Vite prints.
- **Build:** `just build` (or `bun run build` in `web/`) writes static files to `web/dist/`. Preview them with `bun run preview`.
- **Deploy:** every push to `main` builds `web/` and publishes `web/dist/` to GitHub Pages via [`deploy.yml`](.github/workflows/deploy.yml).

> **Status:** the dashboard is still the Vite + Svelte starter. Loading `data/` and charting the results are not implemented yet.

---

## Development Workflow

### Pre-Commit Hooks

After `lefthook install`, each commit runs checks scoped to the files it touches:

| Staged files | Hooks |
| :--- | :--- |
| `benchmark/**/*.rs` | `cargo fmt` (fixes are re-staged), `cargo clippy -D warnings`, `cargo test` |
| `web/**/*.{ts,tsx,js,jsx,json}` | `biome check --write` (fixes are re-staged) |
| `web/**/*.{ts,tsx}` | `bun run typecheck` |

### Continuous Integration

[`ci.yml`](.github/workflows/ci.yml) runs on pushes and pull requests to `main`:

| Job | Steps |
| :--- | :--- |
| **Rust Nightly** | `cargo fmt --check`, `cargo clippy --all-targets --all-features -D warnings`, `cargo test` (all against `benchmark/Cargo.toml`) |
| **Web** | `bun install --frozen-lockfile`, `biome check src`, `bun run typecheck` |

CI runs on Linux, so the macOS-only `mps` kernel is compiled and tested only locally. Run `just check` and `just test` before pushing to catch what CI will.

# gemm-bench

High-performance, safe Rust benchmarks for dense, row-major square matrix multiplication ($C = A \times B$) across CPU and Apple Silicon GPU backends at `f16`, `f32`, `f64`, `i32`, and `i64` precisions, with a web dashboard for exploring the results.

---

## Repository Layout

| Path | Contents |
| :--- | :--- |
| [`benchmark/`](benchmark) | Rust crate `gemm-bench`: the GEMM kernels and the benchmark CLI that produces the data. |
| [`web/`](web) | Bun + Vite + Svelte + TypeScript dashboard that queries the data in the browser with DuckDB-WASM. Deployed to GitHub Pages. |
| [`data/`](data) | Benchmark runs as `runs/<host>/<timestamp>.csv`, and `build.sql`, which validates and merges them for the dashboard. |
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
| [DuckDB CLI](https://duckdb.org) | `just data`, the data pre-commit hook | `brew install duckdb` |
| [lefthook](https://github.com/evilmartians/lefthook) | Optional pre-commit hooks | `brew install lefthook`, then `lefthook install` |

The `mps` GPU kernel requires macOS on Apple Silicon. Everything else runs on any platform supported by Rust nightly. On AArch64 CPUs with FP16 support (such as the Apple M series), `f16` arithmetic compiles to native half-precision instructions.

---

## Quick Start

```sh
git clone https://github.com/paulhondola/gemm-bench.git
cd gemm-bench
just build                # install and build all dependencies
just test                 # run the benchmark crate's test suite
just bench --sizes 256,512 --kernel ikj,rayon-ikj
just dev                  # start the dashboard dev server
```

---

## Commands

Run `just` with no arguments to list every recipe.

| Command | What it runs | Use it to |
| :--- | :--- | :--- |
| `just bench [ARGS]` | `cargo run --release --manifest-path benchmark/Cargo.toml -- [ARGS]` | Run a benchmark sweep. Every argument is forwarded to the CLI (see [CLI Options](#cli-options)). Results go to `data/runs/<host>/<timestamp>.csv` unless `--output` is given. |
| `just build` | `just build-bench`, then `just build-web` | Produce the optimized benchmark binary (`benchmark/target/release/gemm-bench`) and the static dashboard (`web/dist/`). Run one half with `just build-bench` (`cargo build --release`) or `just build-web` (`just data`, then `bun install && bun run build`). |
| `just data` | `duckdb -bail < data/build.sql` | Validate every `data/runs/**/*.csv` and merge them into `web/public/results.parquet`, the file the dashboard queries. A run file missing a required value fails with its filename. `just dev` and `just build` run it first. |
| `just dev` | `bun dev` in `web/` | Start the Vite dev server with hot reload for the dashboard. |
| `just test` | `cargo test --manifest-path benchmark/Cargo.toml` | Run kernel correctness tests (every kernel against `naive-ijk` at all precisions), CLI validation, and report tests. There is no `test-web` target: `web/` has no tests yet. |
| `just lint` | `just lint-bench`, then `just lint-web` | Auto-fix formatting and lint issues in both halves. Run one half with `just lint-bench` (`cargo fmt`) or `just lint-web` (`bun run lint:fix`, Biome). |
| `just check` | `just check-bench`, then `just check-web` | Run the static checks that CI enforces, without modifying files. Run one half with `just check-bench` (`cargo clippy --all-targets -- -D warnings`) or `just check-web` (`bun run typecheck`, `tsc --noEmit`). For Svelte component type checking, run `bun run check` in `web/`. |

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
just bench
```

The full default sweep includes `naive-ijk` at $N = 4096$, which alone takes minutes. Narrow `--sizes` or `--kernel` for quick runs.

### Targeted Sweeps

#### Compare Cache Locality (Single-Threaded)

```sh
just bench \
  --sizes 128,256,512,1024 \
  --kernel naive,ikj,tiled
```

#### Parallel Scaling

```sh
just bench \
  --sizes 512,1024,2048 \
  --threads 1,2,4,8,10 \
  --kernel rayon-ikj,static-ikj \
  --repetitions 5
```

#### Multi-Precision (`f16`, `f32`, `f64`, `i32`, `i64`)

```sh
just bench \
  --sizes 512,1024 \
  --kernel ikj,rayon-ikj \
  --precision f16,f32,f64,i32,i64
```

#### Apple Silicon GPU (MPS)

```sh
just bench \
  --sizes 256,512,1024,2048 \
  --kernel mps \
  --precision f16,f32
```

#### Headless / CI (No Progress Bar)

```sh
just bench \
  --sizes 256,512 \
  --kernel ikj,rayon-ikj \
  --no-progress
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
| `--output <FILE.csv>` | Output file; must have a `.csv` extension. Missing parent directories are created. Run via `just bench` so the default lands in the repo's `data/` | `data/runs/<host>/<timestamp>.csv` |

### Methodology & Output Schema

1. **Warmup Run**: Every configuration executes one untimed warmup pass before measurement, isolating thread pool initialization, cold caches, and dynamic loader overhead from the recorded metrics.
2. **Timing Statistics**: Each configuration runs `--repetitions` timed passes. Records carry the median, minimum, and sample standard deviation; `gops` is derived from the median, which is robust to one-sided scheduler and thermal noise.
3. **Output Verification**: For each size and precision, serial `ikj` computes an untimed reference. After timing, every kernel's output is compared against it, and the run aborts (leaving the existing output file untouched) if the largest element-wise relative error exceeds $4\sqrt{N}\,\varepsilon$, where $\varepsilon$ is the precision's machine epsilon. CPU kernels that sum in the same order as `ikj` match bit-for-bit; the slack covers kernels such as MPS that sum in a different order. Note that `f16` has $\varepsilon = 2^{-10}$, so its check (25% at $N = 4096$) catches broken kernels, not subtle rounding differences. Integers have $\varepsilon = 0$, so `i32`/`i64` outputs must match `ikj` exactly; integer inputs are the small integer numerators ($0$–$28$) rather than fractions, which keeps outputs far from overflow.
4. **Up-Front Validation**: Invalid plans fail before any work runs or any file is created. `static-ikj` and `static-tiled` need at least one matrix row per worker thread, `mps` rejects `f64`, `i32`, and `i64`, and `--output` must be a `.csv` file path, not a directory.
5. **Structured Export**: The output file is opened before the sweep but truncated only when results are written, so a failed run leaves earlier results intact.
   - Columns: `kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, block_size, repetitions, host, commit, timestamp`.
   - `backend` is `cpu` or `metal`. `device` is the CPU model (`sysctl` on macOS, `/proc/cpuinfo` on Linux) or the Metal GPU name.
   - `host` (hostname without domain), `commit` (`git describe --always --dirty`), and `timestamp` (UTC) are captured once per run. Any lookup that fails is written as `unknown`.
   - `mean_rel_error_f64` is `0.0` until accuracy measurement lands.
   - `gops` is $2N^3$ operations per second (from the median time), in billions. The count is $N^3$ multiplies plus $N^3$ adds whatever the element type, so one figure covers the floating-point and the integer precisions alike; `precision` says which kind of operation was counted.

---

## Benchmark Data

Every run is its own file under [`data/runs/`](data/runs), at `data/runs/<host>/<timestamp>.csv`, so reruns and other machines add data instead of replacing it. [`data/build.sql`](data/build.sql) validates the files and merges them into `web/public/results.parquet`.

To contribute results from your machine:

1. `just bench` with the sweep you want. It prints the file it wrote.
2. Commit the new file. The `data-build` pre-commit hook validates it if lefthook and DuckDB are installed.
3. Open a PR. CI runs the same validation, and merged runs deploy to the dashboard.

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
| `web/**/*.{ts,tsx,js,jsx,json,svelte}` | `biome check --write` (fixes are re-staged) |
| `web/**/*.{ts,tsx}` | `bun run typecheck` |
| `data/runs/**/*.csv` | `duckdb -bail < data/build.sql` |

### Continuous Integration

[`ci.yml`](.github/workflows/ci.yml) runs on pushes and pull requests to `main`:

| Job | Steps |
| :--- | :--- |
| **Rust Nightly** | `cargo fmt --check`, `cargo clippy --all-targets --all-features -D warnings`, `cargo test` (all against `benchmark/Cargo.toml`) |
| **Web (Data, Lint, Typecheck, Build)** | `bun install --frozen-lockfile`, install DuckDB, `duckdb -bail < data/build.sql`, `biome check src`, `bun run typecheck`, `bun run build` |

CI runs on Linux, so the macOS-only `mps` kernel is compiled and tested only locally. Run `just check` and `just test` before pushing to catch what CI will.

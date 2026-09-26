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

The `mps`, `metal-naive` and `metal-tiled` GPU kernels and the `accelerate-blas` and `accelerate-bnns` AMX kernels require macOS on Apple Silicon; `accelerate-bnns` also needs macOS 26 at run time, and building it on macOS compiles a small Swift package (`benchmark/swift/BnnsGraph`) with the Xcode command-line tools. Everything else runs on any platform supported by Rust nightly. On AArch64 CPUs with FP16 support (such as the Apple M series), `f16` arithmetic compiles to native half-precision instructions.

---

## Quick Start

```sh
git clone https://github.com/paulhondola/gemm-bench.git
cd gemm-bench
just build                # install and build all dependencies
just test                 # run the benchmark crate's test suite
just bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
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
| `just test` | `just test-bench`, then `just test-web` | Run kernel correctness tests (every kernel against `naive-ijk` at all precisions), CLI validation, and report tests, then the dashboard's data and chart tests. Run one half with `just test-bench` (`cargo test --manifest-path benchmark/Cargo.toml`) or `just test-web` (`bun test` in `web/`, which runs `web/src/**/*.test.ts`). |
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
| `rayon-tiled` | Rayon parallel 2D tiled iterator | Work-stealing over row chunks of at most one tile, about 4 per worker, with 2D tiling inside each chunk. |
| `static-ikj` | OpenMP-style persistent thread pool | Partitions contiguous row chunks evenly across dedicated threads, eliminating work-stealing overhead. |
| `static-tiled` | OpenMP-style thread pool with 2D blocking | Combines deterministic row partitioning on a persistent thread pool with L1/L2 cache-blocked compute. |
| `accelerate-blas` | Vendor BLAS (`cblas_sgemm` / `cblas_dgemm` from Apple Accelerate), macOS only | Apple's CPU reference: on Apple Silicon, Accelerate's Level-3 BLAS runs on the AMX matrix coprocessor. Supports `f32` and `f64` (BLAS has no half-precision or integer GEMM). Accelerate picks its own threading, so its `threads = 1` rows mean one calling thread, not one core; set `VECLIB_MAXIMUM_THREADS` yourself to pin it for experiments. Runs recorded before the BNNS kernel existed are labelled `accelerate` in their CSVs; `data/build.sql` publishes them as `accelerate-blas`. The CLI name changed too: `--kernel accelerate` is now `--kernel accelerate-blas` (clap suggests `accelerate-bnns`, which is a different kernel). |
| `accelerate-bnns` | BNNSGraph matmul (Apple Accelerate, macOS 26+), through a Swift shim | The same AMX coprocessor through BNNS's graph API, compiled once per size outside the timed region. Supports `f16` and `f32` (BNNSGraph has no `f64`, and integer matmul graphs don't execute). **`f16` accumulates in `f16`**, like the CPU kernels and unlike BLAS-style widening, so it is fast but its error grows with n. Threads are recorded as for `accelerate-blas`. |

### Apple Silicon GPU (macOS only)

| Kernel | Backend | Key Characteristics |
| :--- | :--- | :--- |
| `mps` | `MPSMatrixMultiplication` (Metal Performance Shaders) | Runs on the GPU through unified-memory (`StorageModeShared`) buffers. Supports `f16` and `f32`; Apple GPUs have no `f64`. The timed region is GPU execution only (`commit` → `waitUntilCompleted`); an `mps-e2e` record from the same runs adds the buffer copies and command encoding (see Methodology). MPS does **not** use the AMX matrix coprocessor, which is only reachable from the CPU through Accelerate (BLAS or BNNS). |
| `metal-naive` | Hand-written Metal compute shader (`benchmark/src/kernels/metal/gemm.metal`), compiled from source at runtime | One GPU thread per output element, reading A and B straight from device memory. Supports `f16`, `f32`, `i32` and `i64` (MSL `half`, `float`, `int`, `long`; Apple GPUs have no `double`). Accumulates in the element type, like the CPU kernels; `i64` multiplies are emulated in software on Apple GPUs. Timed like `mps`, with a `metal-naive-e2e` record. |
| `metal-tiled` | Same shader source | Each 16×16 threadgroup stages one tile of A and one of B in threadgroup memory per step, so each device-memory element is read once per threadgroup instead of once per thread. The tile is fixed; `--block-size` does not apply. Same precisions, accumulation and timing as `metal-naive`, with a `metal-tiled-e2e` record. At `i64` it runs slower than `metal-naive` on Apple GPUs (measured on an M1 Pro: ~200 vs ~218 GOPS at n=1024-2048) — Apple GPUs emulate 64-bit multiplies in software, so `i64` is compute-bound and tiling saves no memory traffic that matters, while still paying for two threadgroup barriers per 16 multiply-adds. |

---

## Running Benchmarks

### The Full Sweep

Every omitted dimension (`--sizes`, `--threads`, `--kernel`, `--precision`, `--block-size`) sweeps all of its values: sizes `64`–`4096`, powers-of-two thread counts below `available_parallelism()` plus that maximum itself (e.g. `1,2,4,8,10`), every kernel, all five precisions, and block sizes `16`–`256`. With none of them given, `just bench` prints the help instead of starting a run. Opt in to the full sweep, which takes hours, with `--sweep`:

```sh
just bench --sweep
```

### Presets

A preset is a TOML file whose keys are the flag names. List only what you pin: an omitted key sweeps every value, and a listed key is a fixed snapshot, so a kernel added later won't join a preset that names its kernels. Flags on the command line replace the matching key.

```sh
just bench --config configs/quick.toml                 # seconds-long sanity check
just bench --config configs/default.toml               # f32, block 64, everything else swept
just bench --config configs/default.toml --sizes 1024  # a flag replaces its key
```

| Preset | Pins | Use |
| :--- | :--- | :--- |
| `default.toml` | precision `f32`, block size `64` | The default run before `--sweep` existed |
| `quick.toml` | sizes `64,256`, `f32`, block `64`, 3 repetitions | Sanity check |
| `precisions.toml` | size `1024`, block `64`, `ikj,rayon-ikj,mps` | Precision comparison (`mps` is macOS-only) |
| `block-sizes.toml` | sizes `512,1024,2048`, `f32`, the tiled kernels | Block-size sweep |

### Targeted Sweeps

#### Compare Cache Locality (Single-Threaded)

```sh
just bench \
  --sizes 128,256,512,1024 \
  --kernel naive,ikj,tiled \
  --precision f32 \
  --block-size 64
```

#### Parallel Scaling

```sh
just bench \
  --sizes 512,1024,2048 \
  --threads 1,2,4,8,10 \
  --kernel rayon-ikj,static-ikj \
  --precision f32 \
  --repetitions 5
```

#### Multi-Precision (`f16`, `f32`, `f64`, `i32`, `i64`)

```sh
just bench \
  --sizes 512,1024 \
  --kernel ikj,rayon-ikj \
  --precision f16,f32,f64,i32,i64
```

#### Apple Silicon GPU

```sh
just bench \
  --sizes 256,512,1024,2048 \
  --kernel mps,metal-naive,metal-tiled \
  --precision f16,f32
```

#### Headless / CI (No Progress Bar)

```sh
just bench \
  --sizes 256,512 \
  --kernel ikj,rayon-ikj \
  --precision f32 \
  --no-progress
```

### CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--sizes <N,...>` | Matrix dimensions (square $N \times N$), comma-delimited | All: `64,128,256,512,1024,2048,4096` |
| `--threads <T,...>` | Worker thread counts for parallel kernels | Powers of 2 below CPU count, plus the maximum |
| `--kernel <K,...>` | Kernel(s) to benchmark (`naive`, `ikj`, `tiled`, `rayon-ikj`, `rayon-tiled`, `static-ikj`, `static-tiled`, `accelerate-blas`, `accelerate-bnns`, `mps`, `metal-naive`, `metal-tiled`) | All kernels; combinations a kernel can't run are skipped with a notice (`accelerate-blas` outside `f32`/`f64`, `accelerate-bnns` and `mps` outside `f16`/`f32`, `metal-naive` and `metal-tiled` outside `f16`/`f32`/`i32`/`i64`, static kernels with more threads than rows) |
| `--precision <P,...>` | Precision(s) to benchmark (`f16`, `f32`, `f64`, `i32`, `i64`; `accelerate-blas` supports only `f32` and `f64`, `accelerate-bnns` and `mps` only `f16` and `f32`, `metal-naive` and `metal-tiled` skip `f64`) | All: `f16,f32,f64,i32,i64` |
| `--repetitions <R>` | Timed iterations measured per configuration (median, min, and standard deviation are recorded) | `5` |
| `--block-size <B,...>` | Tile edge length(s) for the tiled kernels (`tiled`, `rayon-tiled`, `static-tiled`), comma-delimited. Other kernels run once and record an empty `block_size` | All: `16,32,64,128,256` |
| `--no-progress` | Disables the interactive `indicatif` progress bar | `false` |
| `--output <FILE.csv>` | Output file; must have a `.csv` extension. Missing parent directories are created. Run via `just bench` so the default lands in the repo's `data/` | `data/runs/<host>/<timestamp>.csv` |
| `--sweep` | Run with no dimension pinned: every value of every dimension (hours). Without it and with nothing pinned, the help is shown | `false` |
| `--config <FILE.toml>` | Preset whose keys are the flag names (`sizes`, `threads`, `kernel`, `precision`, `block-size`, `repetitions`); unknown keys are rejected. A flag on the command line replaces the matching key; omitted keys sweep every value | none |

### Methodology & Output Schema

1. **Warmup Run**: Every configuration executes one untimed warmup pass before measurement, isolating thread pool initialization, cold caches, and dynamic loader overhead from the recorded metrics.
2. **Timing Statistics**: Each configuration runs `--repetitions` timed passes. Records carry the median, minimum, and sample standard deviation; `gops` is derived from the median, which is robust to one-sided scheduler and thermal noise. Metal kernels produce two records per configuration from the same repetitions: the plain label times GPU execution only (`commit` → `waitUntilCompleted`), and `<label>-e2e` also includes copying the inputs into the shared buffers, encoding the command buffer, and copying the result back. Both carry the same accuracy.
3. **Output Verification**: For each size and precision, serial `ikj` computes an untimed reference. After timing, every kernel's output is compared against it, and the run aborts (leaving the existing output file untouched) if the largest element-wise relative error exceeds $4\sqrt{N}\,\varepsilon$, where $\varepsilon$ is the precision's machine epsilon. CPU kernels that sum in the same order as `ikj` match bit-for-bit; the slack covers kernels such as MPS that sum in a different order. Note that `f16` has $\varepsilon = 2^{-10}$, so its check (25% at $N = 4096$) catches broken kernels, not subtle rounding differences. Integers have $\varepsilon = 0$, so `i32`/`i64` outputs must match `ikj` exactly; integer inputs are the small integer numerators ($0$–$28$) rather than fractions, which keeps outputs far from overflow.
4. **Up-Front Validation**: Invalid plans fail before any work runs or any file is created. `--output` must be a `.csv` file path, not a directory. A (kernel, precision) or (static kernel, thread count) combination that can't run — `accelerate-blas` outside `f32`/`f64`, `accelerate-bnns` or `mps` outside `f16`/`f32`, `metal-naive`/`metal-tiled` at `f64`, or a static kernel with more threads than matrix rows — is skipped with a stderr notice rather than rejected; a plan is only rejected when a kernel named explicitly (by `--kernel` or a config's `kernel` key) has nothing runnable at all.
5. **Structured Export**: The output file is opened before the sweep but truncated only when results are written, so a failed run leaves earlier results intact.
   - Columns: `kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, block_size, repetitions, host, commit, timestamp`. `block_size` is empty for kernels that don't tile.
   - `backend` is `cpu`, `amx` (the `accelerate-blas` and `accelerate-bnns` kernels), or `metal`. `device` is the CPU model (`sysctl` on macOS, `/proc/cpuinfo` on Linux) or the Metal GPU name.
   - `host` (hostname without domain), `commit` (`git describe --always --dirty`), and `timestamp` (UTC) are captured once per run. Any lookup that fails is written as `unknown`.
   - `mean_rel_error_f64` is the kernel's accuracy: the mean element-wise relative error against the same inputs widened to `f64` and multiplied in `f64` (untimed, once per size and precision). It counts only the kernel's arithmetic, not the rounding of its inputs, so `f64` CPU kernels and exact `i32`/`i64` products score `0`. It is informational; step 3's check is what aborts a run. Runs recorded before 2026-09-24 wrote a `0.0` placeholder, which `just data` publishes as `NULL`.
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

It loads `web/public/results.parquet` into DuckDB-WASM in the browser and charts it with [Observable Plot](https://observablehq.com/plot/) in six tabs: Overview (one line per kernel family), CPU & AMX, CPU threading, Precision, GPU, and Block size. Pickers narrow each tab by precision, matrix size, block size, or kernel, and a Relative toggle switches to speedup (over `naive-ijk` on CPU & AMX, over one thread on CPU threading). GPU kernels are charted with their end-to-end (`-e2e`) timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the GPU-only share as copy overhead. Charts that span kernel families colour by family, and per-kernel charts show either host or GPU kernels, never both. Chart definitions live in `web/src/lib/charts/`, each with a `bun test` suite next to it.

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

CI runs on Linux, so the macOS-only Metal kernels (`mps`, `metal-naive`, `metal-tiled`) are compiled and tested only locally. Run `just check` and `just test` before pushing to catch what CI will.

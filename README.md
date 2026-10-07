# gemm-bench

High-performance, safe Rust benchmarks for dense, row-major square matrix multiplication ($C = A \times B$) across CPU and Apple Silicon GPU backends at `f16`, `f32`, `f64`, `i32`, and `i64` precisions, with a web dashboard for exploring the results.

---

## Repository Layout

| Path | Contents |
| :--- | :--- |
| [`benchmark/`](benchmark) | Rust crate `gemm-bench`: the GEMM kernels and the benchmark CLI that produces the data. |
| [`web/`](web) | Bun + Vite + Svelte + TypeScript dashboard that charts the run data in the browser. Deployed to GitHub Pages. |
| [`data/`](data) | One SQLite database per host at `db/<github-login>/<machine>.sqlite`, the schema they share (`schema.sql`), and hand-curated hardware peaks (`peaks.csv`). |
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
| [lefthook](https://github.com/evilmartians/lefthook) | Optional pre-commit hooks | `brew install lefthook`, then `lefthook install` |

The `mps`, `metal-naive`, `metal-tiled` and `metal-simdgroup` GPU kernels and the `accelerate-blas` and `accelerate-bnns` AMX kernels require macOS on Apple Silicon; `accelerate-bnns` also needs macOS 26 at run time, and building it on macOS compiles a small Swift package (`benchmark/swift/BnnsGraph`) with the Xcode command-line tools. Everything else runs on any platform supported by Rust nightly. On AArch64 CPUs with FP16 support (such as the Apple M series), `f16` arithmetic compiles to native half-precision instructions.

---

## Quick Start

Cargo uses [`.cargo/config.toml`](.cargo/config.toml) to compile for the local CPU (`-C target-cpu=native`), including when invoked through `just`. Build on each machine you benchmark: the resulting binary can require instructions unavailable on other CPUs. Run Cargo from the repository root or `benchmark/` so it discovers this configuration. An explicit `RUSTFLAGS` or `CARGO_ENCODED_RUSTFLAGS` environment variable overrides this setting.

```sh
git clone https://github.com/paulhondola/gemm-bench.git
cd gemm-bench
just build                # install and build all dependencies
just test                 # run the benchmark crate's test suite
just init octocat/m1pro   # once: names your database (<github-login>/<machine>)
just bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
just dev                  # start the dashboard dev server
```

---

## Commands

Run `just` with no arguments to list every recipe.

| Command | What it runs | Use it to |
| :--- | :--- | :--- |
| `just bench [ARGS]` | `cargo run --release --manifest-path benchmark/Cargo.toml -- [ARGS]` | Run a benchmark sweep. Every argument is forwarded to the CLI (see [CLI Options](#cli-options)). Each run is added to `data/db/<github-login>/<machine>.sqlite` (named once with `just init`) unless `--output` is given. |
| `just build` | `just build-bench`, then `just build-web` | Produce the optimized benchmark binary (`benchmark/target/release/gemm-bench`) and the static dashboard (`web/dist/`). Run one half with `just build-bench` (`cargo build --release`) or `just build-web` (`bun install && bun run build`). |
| `just init <login>/<machine>` | writes `.host` | Name this machine once, as your GitHub login and a machine name (e.g. `just init octocat/m1pro`). `just bench` then writes to `data/db/<login>/<machine>.sqlite`; `.host` is git-ignored. |
| `just validate` | `gemm-bench validate data/db/*/*.sqlite` | Check every committed host database the way CI does (see [Benchmark Data](#benchmark-data)). |
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
| `packed` | Packed operands + `std::simd` register-blocked micro-kernel (GotoBLAS/BLIS) | Copies each k-block of B and each 8-row strip of A into k-major buffers, then keeps an 8 × 3-vector block of C in NEON registers for the whole k-block: 24 fused multiply-adds per 3 B loads, so it is bound by FMA throughput rather than the L1 load/store ports that cap `ikj`. `--depth-block` (alias `--kc`) sets the k-block depth. |
| `rayon-ikj` | Rayon work-stealing parallel iterator | Dynamically distributes row chunks across a Rayon worker thread pool with `ikj` compute. |
| `rayon-tiled` | Rayon parallel 2D tiled iterator | Work-stealing over row chunks of at most one tile, about 4 per worker, with 2D tiling inside each chunk. |
| `rayon-packed` | `packed` with Rayon work stealing | Spreads `packed`'s 8-row strips of C across a Rayon pool; each k-block's packed B panel is shared read-only by every worker. |
| `static-ikj` | OpenMP-style persistent thread pool | Partitions contiguous row chunks evenly across dedicated threads, eliminating work-stealing overhead. |
| `static-tiled` | OpenMP-style thread pool with 2D blocking | Combines deterministic row partitioning on a persistent thread pool with L1/L2 cache-blocked compute. |
| `accelerate-blas` | Vendor BLAS (`cblas_sgemm` / `cblas_dgemm` from Apple Accelerate), macOS only | Apple's CPU reference: on Apple Silicon, Accelerate's Level-3 BLAS runs on the AMX matrix coprocessor. Supports `f32` and `f64` (BLAS has no half-precision or integer GEMM). Accelerate picks its own threading, so its `threads = 1` rows mean one calling thread, not one core; set `VECLIB_MAXIMUM_THREADS` yourself to pin it for experiments. The CLI name changed when the BNNS kernel arrived: `--kernel accelerate` is now `--kernel accelerate-blas` (clap suggests `accelerate-bnns`, which is a different kernel). |
| `accelerate-bnns` | BNNSGraph matmul (Apple Accelerate, macOS 26+), through a Swift shim | The same AMX coprocessor through BNNS's graph API, compiled once per size outside the timed region. Supports `f16` and `f32` (BNNSGraph has no `f64`, and integer matmul graphs don't execute). **`f16` accumulates in `f16`**, like the CPU kernels and unlike BLAS-style widening, so it is fast but its error grows with n. Threads are recorded as for `accelerate-blas`. |

### Apple Silicon GPU (macOS only)

| Kernel | Backend | Key Characteristics |
| :--- | :--- | :--- |
| `mps` | `MPSMatrixMultiplication` (Metal Performance Shaders) | Runs on the GPU through unified-memory (`StorageModeShared`) buffers. Supports `f16` and `f32`; Apple GPUs have no `f64`. Its timings are the round trip a caller waits for (copying the inputs into the buffers, encoding, GPU execution, copying the result back), and `gpu_ms` records the GPU execution alone (see Methodology). MPS does **not** use the AMX matrix coprocessor, which is only reachable from the CPU through Accelerate (BLAS or BNNS). |
| `metal-naive` | Hand-written Metal compute shader (`benchmark/src/kernels/metal/gemm.metal`), compiled from source at runtime | One GPU thread per output element, reading A and B straight from device memory. Supports `f16`, `f32`, `i32` and `i64` (MSL `half`, `float`, `int`, `long`; Apple GPUs have no `double`). Accumulates in the element type, like the CPU kernels; `i64` multiplies are emulated in software on Apple GPUs. Timed like `mps`. |
| `metal-tiled` | Same shader source | Each 16×16 threadgroup stages one tile of A and one of B in threadgroup memory per step, so each device-memory element is read once per threadgroup instead of once per thread. The tile is fixed, so no knob applies. Same precisions, accumulation and timing as `metal-naive`. At `i64` it runs slower than `metal-naive` on Apple GPUs (measured on an M1 Pro: ~200 vs ~218 GOPS at n=1024-2048) — Apple GPUs emulate 64-bit multiplies in software, so `i64` is compute-bound and tiling saves no memory traffic that matters, while still paying for two threadgroup barriers per 16 multiply-adds. |
| `metal-simdgroup` | Same shader source | Each threadgroup of 4 simdgroups (128 threads) computes a 64×64 block of C. Per 16-deep step it stages a strip of A and one of B in threadgroup memory (zeros past the edge), and each simdgroup multiplies 8×8 `simdgroup_matrix` fragments out of them into the 32×32 part of the block it holds in registers, so each value read from threadgroup memory feeds many multiply-adds instead of one. Interior results go straight from registers to C. Supports `f16` and `f32` only (`simdgroup_matrix` has no integer types). The block shape is fixed, so no knob applies. Accumulates in the element type; timed like `mps`. On M1 the fragment multiplies run on the ordinary GPU ALUs: there is no matrix hardware. |

---

## Running Benchmarks

### The Full Sweep

Every omitted dimension (`--sizes`, `--threads`, `--kernel`, `--precision`, `--tile-size`, `--depth-block`) sweeps all of its values: sizes `64`–`4096`, powers-of-two thread counts below `available_parallelism()` plus that maximum itself (e.g. `1,2,4,8,10`), every kernel, all five precisions, tile sizes `16`–`256` and depth blocks `64`–`1024`. With none of them given, `just bench` prints the help instead of starting a run. Opt in to the full sweep, which takes hours, with `--sweep`:

```sh
just bench --sweep
```

### Presets

A preset is a TOML file whose keys are the flag names. List only what you pin: an omitted key sweeps every value, and a listed key is a fixed snapshot, so a kernel added later won't join a preset that names its kernels. Flags on the command line replace the matching key.

```sh
just bench --config configs/quick.toml                 # seconds-long sanity check
just bench --config configs/default.toml               # f32, tile 64, depth block 256, everything else swept
just bench --config configs/default.toml --sizes 1024  # a flag replaces its key
```

| Preset | Pins | Use |
| :--- | :--- | :--- |
| `default.toml` | precision `f32`, tile size `64`, depth block `256` | The default run before `--sweep` existed |
| `quick.toml` | sizes `64,256`, `f32`, tile `64`, depth block `256`, 3 repetitions | Sanity check |
| `precisions.toml` | size `1024`, `ikj,rayon-ikj,mps` | Precision comparison (`mps` is macOS-only) |
| `knobs.toml` | sizes `512,1024,2048`, `f32`, the tiled and packed kernels | Every tile size and depth block |
| `x86.toml` | precisions `f32,f64,i32,i64` | Full sweep on x86, with `x86-f16.toml` |
| `x86-f16.toml` | `f16`, every CPU kernel but `packed` and `rayon-packed` | The f16 half of the x86 sweep |

On x86 CPUs without AVX-512 FP16, `packed` and `rayon-packed` run `f16` dozens of times slower than `f32`, which took half of a full sweep's time on a Ryzen 5 7535HS. Sweep those hosts with `just bench --config configs/x86.toml`, then `just bench --config configs/x86-f16.toml`.

### Targeted Sweeps

#### Compare Cache Locality (Single-Threaded)

```sh
just bench \
  --sizes 128,256,512,1024 \
  --kernel naive,ikj,tiled \
  --precision f32 \
  --tile-size 64
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
  --kernel mps,metal-naive,metal-tiled,metal-simdgroup \
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
| `--kernel <K,...>` | Kernel(s) to benchmark (`naive`, `ikj`, `tiled`, `packed`, `rayon-ikj`, `rayon-tiled`, `rayon-packed`, `static-ikj`, `static-tiled`, `accelerate-blas`, `accelerate-bnns`, `mps`, `metal-naive`, `metal-tiled`, `metal-simdgroup`) | All kernels; combinations a kernel can't run are skipped with a notice (`accelerate-blas` outside `f32`/`f64`, `accelerate-bnns`, `mps` and `metal-simdgroup` outside `f16`/`f32`, `metal-naive` and `metal-tiled` outside `f16`/`f32`/`i32`/`i64`, static kernels with more threads than rows) |
| `--precision <P,...>` | Precision(s) to benchmark (`f16`, `f32`, `f64`, `i32`, `i64`; `accelerate-blas` supports only `f32` and `f64`, `accelerate-bnns`, `mps` and `metal-simdgroup` only `f16` and `f32`, `metal-naive` and `metal-tiled` skip `f64`) | All: `f16,f32,f64,i32,i64` |
| `--repetitions <R>` | Timed iterations measured per configuration (median, min, and standard deviation are recorded) | `5` |
| `--tile-size <T,...>` (alias `--tile`) | Tile edge(s) for `tiled`, `static-tiled` and `rayon-tiled`, comma-delimited. Naming it when no selected kernel sweeps it is an error | All: `16,32,64,128,256` |
| `--depth-block <D,...>` (alias `--kc`) | Depth of each packed k-block (BLIS's KC) for `packed` and `rayon-packed`, comma-delimited. Naming it when no selected kernel sweeps it is an error | All: `64,128,256,512,1024` |
| `--no-progress` | Disables the interactive `indicatif` progress bar | `false` |
| `--output <FILE.sqlite>` | Database to add the run to; must have a `.sqlite` extension. Missing parent directories are created, a new file gets `data/schema.sql`, and a file that isn't a gemm-bench database (or is read-only, or already holds a run started in the same second) is refused before anything runs | `data/db/<login>/<machine>.sqlite`, from `.host` |
| `--sweep` | Run with no dimension pinned: every value of every dimension (hours). Without it and with nothing pinned, the help is shown | `false` |
| `--config <FILE.toml>` | Preset whose keys are the flag names (`sizes`, `threads`, `kernel`, `precision`, `tile-size` or `tile`, `depth-block` or `kc`, `repetitions`); unknown keys are rejected. A flag on the command line replaces the matching key; omitted keys sweep every value | none |
| `validate <DB...>` | Subcommand: check host databases (path, size, stamps, integrity, schema, kernels, params, runs, text) and print `ok` or `FAIL` per file; exits non-zero if any fails | none |

### Methodology & Output Schema

1. **Warmup Run**: Every configuration executes one untimed warmup pass before measurement, isolating cold caches, first thread wake-ups, and dynamic loader overhead from the timed repetitions. Building the kernel before it (a thread pool, a BNNS graph, a compiled Metal shader) is timed once, as `setup_ms`.
2. **Timing Statistics**: Each configuration runs `--repetitions` timed passes. Records carry the median, minimum, and sample standard deviation; `gops` is derived from the median, which is robust to one-sided scheduler and thermal noise. Every configuration writes one record, timed as a caller sees it: one `compute` call on the CPU and AMX, and on Metal the whole round trip of copying the inputs into the shared buffers, encoding the command buffer, GPU execution, and copying the result back. Metal records also carry `gpu_ms`, the median GPU execution alone (`commit` → `waitUntilCompleted`) over the same repetitions.
3. **Output Verification**: For each size and precision, serial `ikj` computes an untimed reference. After timing, every kernel's output is compared against it, and the run aborts (leaving the existing output file untouched) if the largest element-wise relative error exceeds $4\sqrt{N}\,\varepsilon$, where $\varepsilon$ is the precision's machine epsilon. CPU kernels that sum in the same order as `ikj` match bit-for-bit; the slack covers kernels such as MPS that sum in a different order. Note that `f16` has $\varepsilon = 2^{-10}$, so its check (25% at $N = 4096$) catches broken kernels, not subtle rounding differences. Integers have $\varepsilon = 0$, so `i32`/`i64` outputs must match `ikj` exactly; integer inputs are the small integer numerators ($0$–$28$) rather than fractions, which keeps outputs far from overflow.
4. **Up-Front Validation**: Once the plan is valid, the first thing printed (on stdout, before any notice or timing) is the machine summary: OS, CPU with its core tiers and caches, GPU, and the compiled target features, with `not reported` or `not detected` for anything the OS didn't give. Invalid plans fail before any work runs or any file is created. `--output` must be a `.sqlite` file path, not a directory, and an existing file must be a gemm-bench database without a run started in the same second. A `--tile-size` or `--depth-block` given explicitly that no selected kernel sweeps is rejected. A (kernel, precision) or (static kernel, thread count) combination that can't run — `accelerate-blas` outside `f32`/`f64`, `accelerate-bnns`, `mps` or `metal-simdgroup` outside `f16`/`f32`, `metal-naive`/`metal-tiled` at `f64`, or a static kernel with more threads than matrix rows — is skipped with a stderr notice rather than rejected; a plan is only rejected when a kernel named explicitly (by `--kernel` or a config's `kernel` key) has nothing runnable at all.
5. **Structured Export**: The database is opened and checked before the sweep, and the run is written in one transaction only after it, so a failed or aborted run leaves the file as it was. The schema is [`data/schema.sql`](data/schema.sql):
   - `runs`: one row per invocation, with its start time (UTC), `commit_id` (`git describe --always --dirty`), `rustc_version`, `repetitions`, and the machine as it was then: `os`, `arch`, `target_features` (what this build was compiled with, e.g. `dotprod fp16 neon`; a default x86-64 build has only SSE2), `cpu`, `available_parallelism`, `gpu` (on macOS, the GPU the Metal kernels run on; on Linux and Windows, the OS's first display adapter) and `gpu_cores` (macOS only). Every lookup runs as a normal user; a value the OS doesn't give is left out, and `cpu` reads `unknown`.
   - `core_tiers` and `caches`: the CPU's kinds of core (Apple's performance and efficiency levels, Intel's core and atom halves, Windows' efficiency classes, or one tier) and every cache configuration per tier, with a `NULL` tier for a cache shared across tiers. A platform that doesn't expose them leaves them empty.
   - `measurements`: one row per configuration: `kernel`, `backend` (`cpu`, `matrix` for Accelerate's matrix unit, or `metal`), `precision`, `n`, `threads`, `gops`, `mean_rel_error_f64`, `median_ms`, `min_ms`, `stddev_ms`, `gpu_ms` (exactly on Metal rows) and `setup_ms`.
   - `params`: each kernel's knobs, one row per knob, as `swept` (a sweep coordinate such as `tile_size`), `derived` (what the kernel actually used, such as `depth_block_used`) or `fixed` (a compile-time constant such as `register_rows`).
   - `setup_ms` is the one-time cost of building the kernel for that configuration, before the warmup run: spawning a thread pool, compiling a BNNS graph, or creating a Metal device, compiling the shader and allocating the buffers (≈ 0 for kernels with nothing to build). It is a single sample and depends on order (the first Metal device in a process pays driver initialization, and Metal caches compiled shaders), so read it as an order of magnitude.
   - `mean_rel_error_f64` is the kernel's accuracy: the mean element-wise relative error against the same inputs widened to `f64` and multiplied in `f64` (untimed, once per size and precision). It counts only the kernel's arithmetic, not the rounding of its inputs, so `f64` CPU kernels and exact `i32`/`i64` products score `0`. A kernel that produced NaN records `+Inf`; SQLite stores NaN as `NULL`. It is informational; step 3's check is what aborts a run.
   - `gops` is $2N^3$ operations per second (from the median time), in billions. The count is $N^3$ multiplies plus $N^3$ adds whatever the element type, so one figure covers the floating-point and the integer precisions alike; `precision` says which kind of operation was counted.

---

## Benchmark Data

Each machine has one SQLite database, committed at `data/db/<github-login>/<machine>.sqlite`, and every run adds to it. The dashboard charts the latest run of each cell (kernel, precision, size, threads and swept knobs), so a rerun replaces what it measures and the rest stays.

To contribute results from your machine:

1. `just init <github-login>/<machine>` once, e.g. `just init octocat/m1pro`.
2. `just bench` with the sweep you want. It prints the database it wrote to.
3. Commit the database. The `host-db-validate` pre-commit hook runs `gemm-bench validate` on it if lefthook is installed.
4. Open a PR. CI runs the same validation and checks that the PR changes only `data/db/<your-login>/`; merged databases deploy to the dashboard.

The databases are binary, so review can't see what changed: [`validate`](benchmark/src/validate/mod.rs) is the gate. It checks the path and size (at most 16 MB), that the file is a regular file in rollback-journal mode (not a symlink or WAL-mode file), the `application_id` and `user_version` stamps, `PRAGMA integrity_check` and `foreign_key_check`, that the stored schema is byte-identical to [`data/schema.sql`](data/schema.sql), that every kernel, backend and precision is one the tool has, that each measurement records exactly its kernel's declared params, that no cell repeats within a run, that no run is empty, and that free text is short and printable. It judges a private copy of the file's bytes, never the file itself.

[`data/peaks.csv`](data/peaks.csv) holds hand-curated hardware ceilings in GFLOP/s, which the dashboard draws against the runs. Each row is one ceiling for a `device`, `backend`, `precision`, and number of busy `cores`, not a per-core rate, because the P-core clock falls as more cores are busy. Every row must cite its source. `bun test` (`web/src/lib/peaks.test.ts`) checks the file strictly: the header must match exactly, every value must be present, `cores` must be a whole number ≥ 1, `gflops` finite and positive, and `backend` either `cpu` or `metal`. No ceiling may be listed twice, and every row must match a host's `device`, `backend`, and `precision`. A GPU ceiling also matches on the run's `gpu_cores`, since the 14- and 16-core M1 Pro GPUs report the same name.

---

## Web Dashboard

The dashboard in [`web/`](web) is a Vite + Svelte 5 + TypeScript app linted and formatted with [Biome](https://biomejs.dev).

- **Develop:** `just dev`, then open the URL Vite prints.
- **Build:** `just build` (or `bun run build` in `web/`) writes static files to `web/dist/`. Preview them with `bun run preview`.
- **Deploy:** every push to `main` builds `web/` and publishes `web/dist/` to GitHub Pages via [`deploy.yml`](.github/workflows/deploy.yml).

It fetches the selected host's database (a picker lists every `data/db/<login>/<machine>.sqlite`, and `?host=<login>/<machine>` links to one), opens it in the browser with [sql.js](https://sql.js.org), reads the `latest` view from `web/src/lib/data/views.sql`, and charts it with [Plotly.js](https://plotly.com/javascript/) in six tabs: Overview (one line per kernel family), CPU & matrix, CPU threading, Precision, GPU, and Tuning knobs. Every chart has a "How to read this chart" toggle under its title, and a seventh tab, About, covers the hardware tested (the selected host's core tiers, caches, GPU and build, and each engine's peak against its best measured result) and every kernel (what it does, a pseudo-code sketch, how it reaches the hardware). That documentation is Markdown in `web/src/docs/`, rendered with [marked](https://marked.js.org): one file per chart, one per kernel family, plus the About page's intro and hardware entry. Its `bun test` suites fail when a chart panel has no doc, or a kernel in `benchmark/src/kernel.rs` has no section. The Overview opens with an optimization ladder: the fastest result of each technique from `naive-ijk` to the GPU, with the multiplier each step buys, at the largest N every rung measured. The Overview's family chart and the GPU tab's kernel chart draw the hardware peaks as dashed ceilings and give % of peak on hover; the matrix unit and the integer precisions have none. The Precision tab adds an accuracy-vs-throughput scatter: each float kernel's mean relative error against its GOP/s at the selected size, leaving out exact results, which a log axis can't show. Pickers narrow each tab by precision, matrix size, tile size, depth block, or kernel, and a Relative toggle switches to speedup (over `naive-ijk` on CPU & matrix, over one thread on CPU threading). Every chart has Plotly's built-ins: drag to zoom and double-click to reset, click a legend entry to hide that series or double-click it to show only that one, hover for every series' value at that point, and download the chart as SVG from its toolbar. A hidden series stays hidden while you change pickers. GPU kernels are charted with their end-to-end timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the time outside `gpu_ms` as copy overhead. Charts that span kernel families colour by family, and per-kernel charts show either host or GPU kernels, never both. Chart definitions live in `web/src/lib/charts/` as pure functions that return Plotly JSON, each with a `bun test` suite next to it.

---

## Development Workflow

### Pre-Commit Hooks

After `lefthook install`, each commit runs checks scoped to the files it touches:

| Staged files | Hooks |
| :--- | :--- |
| `benchmark/**/*.rs` | `cargo fmt` (fixes are re-staged), `cargo clippy -D warnings`, `cargo test` |
| `web/**/*.{ts,tsx,js,jsx,json,svelte}` | `biome check --write` (fixes are re-staged) |
| `web/**/*.{ts,tsx,svelte}` | `bun run typecheck` (svelte-check) |
| `data/db/*/*.sqlite` | `gemm-bench validate` on the staged databases |

### Continuous Integration

[`ci.yml`](.github/workflows/ci.yml) runs on pushes and pull requests to `main`:

| Job | Steps |
| :--- | :--- |
| **Rust Nightly** | `cargo fmt --check`, `cargo clippy --all-targets --all-features -D warnings`, `cargo test` (all against `benchmark/Cargo.toml`), `gemm-bench validate` on every committed database, and on pull requests a check that only `data/db/<author>/` changed |
| **Web (Lint, Typecheck, Test, Build)** | `bun install --frozen-lockfile`, `biome check src`, `bun run typecheck`, `bun test`, `bun run build` |

CI runs on Linux and Windows, so the macOS-only Metal kernels (`mps`, `metal-naive`, `metal-tiled`, `metal-simdgroup`) are compiled and tested only locally. Run `just check` and `just test` before pushing to catch what CI will.

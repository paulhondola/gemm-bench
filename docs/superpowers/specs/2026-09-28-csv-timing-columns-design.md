# CSV Timing Columns: `gpu_ms` and `setup_ms`

- **Status:** Approved in brainstorming (2026-09-28), pending spec review
- **Branch:** `feat/csv-timing-columns`
- **Supersedes:** the "Schema changes" non-goal of `2026-09-25-dashboard-gpu-families-design.md` (timing scope encoded as the `-e2e` label suffix) and the `withEndToEnd` fold it introduced.
- **Blocks:** the HPC-metrics dashboard work (`feat/dashboard-hpc-metrics`), which rebases onto this.

## Problem

- **One measurement, two records.** `time_dispatch` times two nested windows per repetition, and `run_precision` turns them into two full records: `mps` (GPU-only) and `mps-e2e` (round trip). The label carries a timing scope, `gops` means GPU-only on one row and caller-visible on its twin, and the dashboard folds the pair back into one row (`withEndToEnd`, matching on seven fields).
- **Setup is paid but never recorded.** `measure` builds each kernel before its warm-up — a thread pool, a BNNS graph, a Metal device plus a shader compiled from source, GPU buffers — and none of it is timed. The data cannot say what it costs to get a kernel ready, e.g. whether the GPU pays off for a single multiply.

## Goals

1. One record per measurement. `median_ms`, `min_ms`, `stddev_ms` and `gops` are the caller-visible time on every row (end-to-end on Metal), so `gops` means the same thing on every row.
2. Metal rows carry `gpu_ms`, the median of the GPU-only window. It is empty on every other row.
3. Every row carries `setup_ms`, the one-time cost of preparing that configuration's kernel.
4. `build.sql` rejects a row with the wrong shape, so a stale run file fails the build instead of mixing timing scopes.
5. The dashboard reads rows as they are; `withEndToEnd` is deleted.

## Non-Goals

- Charting `setup_ms`. A break-even chart is future work; the column shows in the data view.
- `first_call_ms` (the warm-up run's duration). Added with the chart that needs it; reruns are cheap.
- Thread-pool fork/join overhead. It happens inside the timed call and cannot be separated without perturbing it; it would be a separate microbenchmark.
- Splitting the GPU overhead into upload, encode and download, or recording `gpu_ms`'s min and stddev. Nothing consumes them.
- Migrating old run files. Every file is regenerated (see Data Regeneration).

## Design

### Column Semantics

| Column | Type | Meaning | Set on |
| :--- | :--- | :--- | :--- |
| `median_ms`, `min_ms`, `stddev_ms` | DOUBLE | Wall time of the timed repetitions as a caller sees it. CPU and AMX: one `compute` call. Metal: upload → encode → commit → wait → download. | every row |
| `gops` | DOUBLE | $2N^3$ / `median_ms`, as today. | every row |
| `gpu_ms` | DOUBLE, nullable | Median of `commit` → `waitUntilCompleted` over the same repetitions. | Metal rows only; empty elsewhere, like `block_size` for kernels that don't tile |
| `setup_ms` | DOUBLE | Wall time to make the kernel ready for this configuration, one sample, taken before the warm-up run. | every row |

Column order: `…, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, block_size, …`.

What `setup_ms` times, per kernel:

| Kernel | Timed |
| :--- | :--- |
| `naive-ijk`, `ikj`, `accelerate-blas` | Nothing to build (unit structs); ≈ 0 |
| `tiled` | `TiledGemm::new` (stores the block size); ≈ 0 |
| `rayon-ikj`, `rayon-tiled`, `static-ikj`, `static-tiled` | Building a pool of `threads` workers, which spawns the threads |
| `accelerate-bnns` | Compiling the BNNSGraph for this `n` |
| `mps` | Metal device and command queue, then allocating the three `n`×`n` shared buffers |
| `metal-naive`, `metal-tiled` | Device and queue, compiling `gemm.metal` from source and building the pipeline, then allocating the buffers |

Not setup: the input and output `Matrix` allocations (the harness's, shared by every kernel), the warm-up run, and the reference computations.

`setup_ms` is a single sample and depends on order: the first Metal device in a process pays driver initialization, and Metal's shader cache can speed up a repeat compile. It reads as an order of magnitude, not a figure to compare to a few percent. The README says so.

### Harness (`benchmark/`)

- `Samples` becomes `{ timed, gpu: Option<Vec<Duration>>, setup: Duration }`. On Metal, `timed` holds the end-to-end samples and `gpu` the GPU-only ones.
- `measure` times each kernel's construction and records it as `setup`.
- Metal buffers are allocated inside `time_dispatch`, before its loop. `GpuSamples` gains a `setup: Duration` for that allocation, and `measure` adds it to the constructor's time.
- `run_precision` pushes one `BenchmarkRecord` per measurement. The `-e2e` label and the two-record loop go away; `gpu_ms` is the median of `gpu`.
- `BenchmarkRecord` gains `gpu_ms: Option<f64>` (serialized empty when `None`, like `block_size`) and `setup_ms: f64`.
- The terminal table gains `gpu_ms` (`-` off Metal) and `setup_ms` columns, so the GPU-only time stays visible after a run.

### Data (`data/build.sql`)

- `types` gains `gpu_ms` and `setup_ms` as `DOUBLE`.
- The required-values check gains `setup_ms`.
- A new check fails with the offending files unless `gpu_ms` is set exactly on `backend = 'metal'` rows.
- The JSON export writes a non-finite `gpu_ms` or `setup_ms` as null, like the other doubles.

A run file written before this change has no `setup_ms` column, so `union_by_name` fills it with NULL and the required-values check names the file.

### Dashboard (`web/`)

- Delete `withEndToEnd`, `E2E_SUFFIX`, `measurementKey` and their tests. `boot` keeps `partitionPlottable`'s rows as they are.
- The copy-overhead chart already reads `r.gpu_ms != null` and is unchanged. Comments in `gpu.ts`, `overview.ts` and `gpu.test.ts` that cite `withEndToEnd` cite the schema instead.
- `setup_ms` appears in the data view only.

### Docs

- README: the CSV column list, methodology step 2 (one record per measurement, `gpu_ms`, `setup_ms` and its caveat), the GPU kernel table's "`X-e2e` record" wording, and the dashboard paragraph's `-e2e` mention.
- README: remove the notes that regeneration makes moot and that `build.sql` no longer implements anyway — CSVs labelled `accelerate` being published as `accelerate-blas` (the CLI rename note stays), and the pre-2026-09-24 `0.0` accuracy placeholder being published as NULL.

## Data Regeneration

1. Delete every file under `data/runs/Pauls-MacBook-Pro/`.
2. Rerun in one pass: `just bench --block-size 16,32,64,128,256,512,1024,2048`. Every other dimension sweeps (all kernels and precisions, sizes 64–4096, threads 1–10), so this replaces both the old full sweep and the extended block-size run, and runs each non-tiling kernel once instead of twice.
3. Run it overnight on a quiet machine: in daytime, background load swings 8+ thread medians by about ±15%; at night, 2–5%.
4. Commit the new file in the same PR. `build.sql`'s checks reject the old files, so code and data land together.

## Testing

- **Rust.** CPU kernels have no GPU window and a setup time. Metal kernels have both windows, the same number of samples in each, and a non-zero setup. Each GPU-only sample fits inside its end-to-end sample (the existing check, renamed). A Metal measurement produces one record whose `gops` comes from the end-to-end median and whose `gpu_ms` is the GPU-only median. The CSV header has `gpu_ms` and `setup_ms` in order, with `None` written empty.
- **`build.sql`.** `just data` passes on the regenerated data. It fails, naming the file, on a scratch run file with a Metal row missing `gpu_ms`, a CPU row with `gpu_ms`, and a row missing `setup_ms`.
- **Web.** `bun test` passes with `withEndToEnd`'s tests removed; GPU chart fixtures already use the folded shape the CSV now writes.
- **End to end.** `just dev`: the GPU tab's copy-overhead chart renders, and the data view lists `gpu_ms` and `setup_ms`.

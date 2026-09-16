# Output Verification, Timing Statistics, README Fixes

- **Status:** Implemented (uncommitted working tree on `Restructuring`)
- **Roadmap item:** 1 of 5
- **Depends on:** nothing. Items 2–5 rely on the verification introduced here.

## Problem

The benchmark review found three trust issues in the existing harness:

1. **No correctness check.** No kernel's output was ever compared to anything. The MPS result was copied back and thrown away. A broken kernel would still print a GFLOPS number.
2. **Weak statistics.** `--repetitions` defaulted to 1 and only a mean was recorded. That's noisy, and the n=4096 numbers may include thermal throttling.
3. **Inaccurate README.** It claimed MPS "engages AMX" (it runs on the GPU), showed `cargo run --release` from the repo root (the crate lives in `benchmark/`), listed default sizes ending at 2048 (they end at 4096), and linked to `scripts/visualize.py`, `plots/`, and `data/*_full_run.csv`, none of which exist.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| What happens on a mismatch? | Abort the run | A wrong kernel's GFLOPS is meaningless, so don't record it. |
| What is the reference? | Serial `IkjGemm`, computed once per (n, precision), untimed | Simplest kernel beyond naive, already covered by the conformance test `every_kernel_matches_naive`, and fast enough (~6 s f32 / ~12 s f64 at n=4096). |
| Tolerance | `4·√n·T::EPSILON`, max element-wise relative error | Kernels that sum each element's n products in a different order build up rounding error. The formula needs no per-precision table. |
| Which statistics? | median, min, sample stddev; GFLOPS from the median | Timing noise on macOS only adds time; the median ignores one-off stalls. |
| `--repetitions` default | 5 | Real data by default; pass `--repetitions 1` for quick runs. |
| Keep `elapsed_ms`? | No, replaced | Nothing reads the CSV/JSON yet (`web/` is still the Svelte starter). |

## Design

### Verification (`benchmark/src/benchmark.rs`)

- `run_precision` builds `reference` with `IkjGemm` right after `benchmark_inputs`, and computes `tolerance::<T>(n)` once per size.
- After `measure` returns, the output buffer holds the result of the last timed run. `max_relative_error(&output, &reference)` compares it.
- `max_relative_error` computes `|out − ref| / max(|ref|, f64::MIN_POSITIVE)` per element and takes the maximum. **NaN is mapped to `+∞`**, because `f64::max` would otherwise silently drop it.
- If `error > tolerance`, return `Err("<kernel> produced wrong output at n=…, precision …, threads …: max relative error … exceeds tolerance …")`.
- `run` / `run_precision` now return `Box<dyn Error>`. `ThreadPoolBuildError` still converts through `?`, and `main` already returns that type.
- On abort, `write_records` never runs. Output files opened at plan time are truncated only by `write_records`, so existing results survive.

### Statistics

- `measure` returns `Vec<Duration>`: each arm pushes one sample per repetition.
- `MpsGemm::benchmark` and `MpsBench::run_mps` return `Vec<Duration>` too.
- `summarize(&[Duration]) -> TimingStats { median_ms, min_ms, stddev_ms }`:
  - Sorts using `f64::total_cmp`.
  - Even-length median is the mean of the two middle values.
  - Stddev uses the sample (n−1) formula and is 0 for a single sample.
- `BenchmarkRecord` columns: `kernel, n, threads, precision, median_ms, min_ms, stddev_ms, gflops`, with `gflops = 2n³ / median_s / 1e9`.
- The terminal table (`report.rs`) shows `median_ms`, `stddev_ms`, and `gflops`. `min_ms` is in the files only.
- CLI: `--repetitions` defaults to 5, and the help text names the statistics.

### README

- MPS section: GPU via `StorageModeShared` buffers, and it does not use AMX. The timed region is `commit` → `waitUntilCompleted`; buffer copies and encoding are excluded.
- Build and run commands use `cargo build --release --manifest-path benchmark/Cargo.toml` and `just bench …`. `just` forwards the flags unchanged; this was checked with `just --dry-run`.
- Default sizes run through 4096, and the `--repetitions` default is 5.
- The methodology section gains "Timing Statistics" and "Output Verification", including the f16 caveat below.
- The Visualizations section is replaced by "Benchmark Data". It notes that `data/*` predates the new columns.

## Verification Results

| Check | Result |
|---|---|
| Unit tests (`summarize` odd/even/single; `max_relative_error` identical/worst/NaN; `tolerance` scaling) | Pass |
| `report.rs` tests updated for the new columns | Pass |
| `cargo clippy --all-targets -D warnings`, `cargo fmt --check` | Clean |
| Real sweep `--sizes 64,256 --precision f16,f32 --repetitions 3 --threads 1,8` | Pass, new columns written |
| Forced tolerance = 0 | `tiled`, `rayon-ikj` still pass (bit-identical to ikj); `mps` aborts, exit 1, no table |
| MPS margin at large n | See below |

Measured MPS error against `ikj`:

| | n=1024 | n=2048 | n=4096 |
|---|---|---|---|
| f16 error / tolerance | 0.7% / 12.5% | 2.1% / 17.7% | 7.3% / 25% |
| f32 error / tolerance | 2.6e-7 / 1.5e-5 | 2.6e-7 / 2.2e-5 | 1.3e-7 / 3.1e-5 |
| CPU kernels (rayon-tiled) | 0 | 0 | 0 |

## Known Limitations and Open Decision

- **`f16::EPSILON` is 2⁻¹⁰**, not the ~2e-4 estimated during design. The f16 tolerance is therefore loose (25% at n=4096). It catches broken kernels (wrong indices, zeros, NaN) but not subtle rounding issues.
- **MPS f16 error grows roughly linearly in n**, not √n. Output magnitude grows with n, which coarsens the f16 value grid. Extrapolating, MPS f16 may cross the tolerance around n≈16384 without being broken.
- **Open:** keep the formula, or give f16 its own tolerance. Decide before running sizes above 8192 at f16.
- `data/*.csv` / `.json` still use the old `elapsed_ms` schema. Regenerating means a full sweep at 5 repetitions (hours), to be run by the user on an idle machine.

## Out of Scope

- Accuracy against an f64 ground truth (item 4).
- End-to-end GPU timing that includes copies and encoding (item 3).

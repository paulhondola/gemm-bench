# Sendoff: Dashboard HPC Metrics

- **Branch:** `feat/dashboard-hpc-metrics` (this file is its only commit, on top of `main` at `c4e610b`)
- **Stage:** brainstorming (superpowers:brainstorming), architectural path. Decisions below are approved; one question is open. No spec or plan yet.
- **Builds on:** PR #20 (`feat/csv-timing-columns`), merged into `main` as `c4e610b` (see [What PR #20 Changed](#what-pr-20-changed)).

## Goal

Make the dashboard argue a point instead of only listing results, for a **portfolio / public** audience: each tab should leave a reader skimming the page with one takeaway. The dashboard's headline unit stays GOP/s, but it gains a denominator (hardware peak), a headline chart (the optimization ladder), and the accuracy half of the precision story.

## Scope

In scope, in order:

1. **% of peak**: dashed ceiling lines and a "% of peak" hover readout.
2. **Optimization ladder**: a new hero chart on the Overview.
3. **Accuracy vs throughput**: a new scatter on the Precision tab.

Future work, not in this spec:

4. P-core/E-core-aware parallel efficiency. The threading tab's "ideal" assumes 10 equal cores; the 2 E-cores are worth about 0.2 P-core each, so rayon's 76% at 10 threads is really about 90%.
5. Latency (µs) at small N, where GOP/s measures dispatch cost rather than throughput.
6. GFLOP/s per watt (Green500-style). Needs new runs with `powermetrics`, which needs sudo.

Also noted but not scheduled: claim-style panel titles ("Loop order buys 12–48×; tiling buys nothing"), and reframing or demoting the Block size tab (its result is essentially null: the best block is usually N itself).

## Decisions Made

| Question | Decision |
| :--- | :--- |
| Audience | Portfolio / public |
| Where hardware peaks live | `data/peaks.csv`, validated by `data/build.sql` like the run files |
| How % of peak is shown | Dashed ceiling line per family, in that family's ink, on the Overview "Throughput by family" chart and the GPU tab's "GPU kernels vs CPU" chart; hover reads e.g. `197 GOP/s · 24% of peak`. GOP/s stays the unit. |
| Optimization ladder | First panel of the Overview. Follows the precision pill; uses the largest N that every rung measured at that precision (4096 at f32). No new controls. |
| Accuracy scatter | Precision tab, follows the N pill. One point per (kernel, precision) at the selected N, float precisions only (f16/f32/f64), colour = family, marker shape = precision. Exact results (error = 0) and non-finite ones (null in `results.json`) are left out, and the panel note says so. |

## Open Question (resume here)

**How peaks reach the charts.** The recommendation on the table is **B**:

- **B (recommended).** `build.sql` validates `data/peaks.csv` and writes `web/public/peaks.json`. The dashboard fetches it beside `results.json`; `makeCtx` gains a peaks lookup (like the palette); `peakOf(row, ctx)` in `derive.ts` owns the scaling rule and is covered by `bun test`. Runs stay measurements (≈4,300 rows), hardware facts stay separate (≈6 rows).
- **A.** `build.sql` left-joins peaks onto every row as a `peak_gflops` column. One file, but the thread-scaling rule lives in SQL where `bun test` can't reach it, and it goes against the dashboard convention (see `.claude/agents/dashboard-designer.md`): derive what a chart needs in its chart function, don't pre-aggregate in the build step.
- **C (ruled out).** Copy the raw CSV to `web/public/` and parse it client-side: skips the validation the repo applies to all contributed data.

Unlike run files, `peaks.csv` is hand-curated, so a non-finite or non-positive peak should **fail the build**, not become null.

After this is answered, the brainstorming process continues: design sections (peaks schema and values → ceilings/hover → ladder → accuracy scatter → testing/docs), then a spec in `docs/superpowers/specs/`, then a plan via superpowers:writing-plans.

## Draft Peak Model

- `peaks.csv` columns (proposal): `device, backend, precision, cores, gflops_per_core, source`.
- A row's peak: `gflops_per_core × min(threads, cores)` for `backend = cpu`; `gflops_per_core × cores` for `metal` (a GPU kernel uses the whole device; its rows record `threads = 1`).
- `cores` counts P-cores only, so 10-thread rows get the 8-core peak and are slightly flattered (the E-cores add about 5%). That is future item 4, not this spec.
- **AMX has no published peak**: no `amx` rows, so no ceiling for that family. Integer precisions have no well-sourced peaks either: no ceiling for i32/i64.
- Ceiling line per family = the peak of the resources that family uses: serial → 1 core, parallel → all P-cores, GPU → whole GPU. Hover % is against the drawn ceiling, so the number and the picture agree.
- Keyed by the CSV's `device` string. Known limit: 14-core and 16-core M1 Pro GPUs both report `"Apple M1 Pro"`. The spec should record this, not work around it.

Paper values for this machine (Apple M1 Pro, 8 P + 2 E cores, 16-core GPU). **Unverified: cite a source for each before publishing.**

| Backend | Precision | Derivation | Peak |
| :--- | :--- | :--- | :--- |
| cpu (per P-core) | f32 | 4 FMA pipes × 128-bit (4 lanes) × 2 FLOP × 3.228 GHz | ≈ 103 GFLOP/s |
| cpu (per P-core) | f64 | half the f32 lanes | ≈ 52 GFLOP/s |
| cpu (per P-core) | f16 | twice the f32 lanes | ≈ 207 GFLOP/s |
| metal (whole GPU) | f32 | 16 cores × 128 ALUs × 2 FLOP × 1.296 GHz (Apple quotes ~5.2 TFLOP/s) | ≈ 5,300 GFLOP/s |
| metal (whole GPU) | f16 | M1-family GPUs run f16 at the f32 rate | ≈ 5,300 GFLOP/s |

Memory bandwidth: 200 GB/s (LPDDR5).

## Chart Sketches

### Ceilings and hover % (Overview, GPU tab)

- `throughputByFamily` (`web/src/lib/charts/overview.ts`) and `gpuKernels` (`web/src/lib/charts/gpu.ts`) gain dashed horizontal shapes, one per family with a peak, in `FAMILY_INK`, plus a direct label ("1-core peak", "CPU peak (8 P)", "GPU peak").
- Hover templates gain `· NN% of peak` where the row's family has a peak.
- Log y-axis: at f32 the ceilings sit at ≈103, ≈826 and ≈5,300.

### Optimization ladder (Overview hero)

- Rungs, in fixed family order (effort progression, not sorted by speed): `naive-ijk` → best serial → best parallel → best AMX → best GPU (end-to-end). Horizontal bars on a log GOP/s axis, each labelled with its value and the step multiplier over the rung before; a title or annotation carries the total ("0.53 → 3,558 GOP/s: 6,800×").
- N = the largest size every present rung measured at the selected precision. A precision with no AMX or GPU rows (i32/i64 have no AMX; f64 has no GPU) just has fewer rungs.
- Reuses `bestPerFamily` from `web/src/lib/derive.ts` plus the `BASELINE_KERNEL` row.
- A step multiplier can be below 1 at some precisions or sizes (at f32 N=1024 the GPU rung is 0.9× AMX); show it honestly rather than reordering.

### Accuracy vs throughput (Precision tab)

- x = `mean_rel_error_f64` (log), y = GOP/s (log), at the selected N; one point per (kernel, precision) using that kernel's best row (`bestPerKernel`). Crosses host and GPU colour groups, so colour by family (palette rule).
- Filter: `typeof e === "number" && e > 0`. That drops exact results (2,464 of 4,256 rows had error exactly 0: integers, and f64 CPU kernels against the f64 reference) and non-finite ones (written as null by `build.sql`).
- The story it must make visible: f16 `mps` accumulates in f32 and is ~130× more accurate than f16 `accelerate-bnns` at similar speed; f16 `metal-tiled` and CPU `ikj` accumulate in f16 and reach ~6.6–6.7% mean error at N=4096.

## Findings From the Analysis

Numbers from the data as it stood on 2026-09-28 (before the timing-columns regeneration). Re-query the regenerated data before quoting them.

- **GOP/s is the right unit** (`2N³ / t` is how LINPACK/TOP500 and BLAS papers report GEMM), but HPC reports it against peak (Rmax/Rpeak). Caveats: at N ≤ ~256 GOP/s measures dispatch latency (the GPU manages 3 GOP/s at N=64); at 8+ threads the median run-to-run variation is 6%, and the worst 10% of configurations vary by 32% (Metal: 48%), while `min_ms` is stable but uncharted; one "GOP/s" axis mixes float and integer operations.
- **% of peak (f32):** serial `ikj` 26 GOP/s ≈ 25% of one P-core; best parallel 197 ≈ 24% of 8 P-cores; `metal-tiled` 577 ≈ 11% of the GPU; `mps` 4,023 GPU-only ≈ 77%, 3,558 end-to-end ≈ 68%.
- **`ikj` is L1 load/store-bound, not FMA-bound:** it sits at ~25% of peak at every float precision (f16 53, f32 26, f64 13 GOP/s), i.e. GOP/s × element size is constant. That is why `tiled` equals `ikj` (32.1 vs 32.2) — no register blocking.
- **i64 is 4× slower than i32 on the CPU**, not 2×: NEON has no 64-bit integer vector multiply, so i64 `ikj` most likely runs scalar.
- **Crossover (f32):** AMX beats the GPU end-to-end at N=1024 (1,876 vs 1,675); from N=2048 the GPU wins (3,078 vs 2,019).
- **Ladder at f32 N=4096:** naive 0.53 → `ikj` 26 (×48) → parallel 159 (×6.2) → AMX 2,315 (×15) → GPU end-to-end 3,558 (×1.5), ≈ 6,800× in total. The naive baseline falls with N (2.09 at 1024), so the total depends on the N chosen.
- **Accuracy (N=4096):** f16 `accelerate-bnns` 1.7% mean error, f16 `mps` 0.013%, f16 `ikj` 6.6%, f16 `metal-tiled` 6.7%; f32 kernels ~3e-7.
- **A roofline would not help:** f32 GEMM's arithmetic intensity is N/6 FLOP/byte against a CPU balance point of ~826/200 ≈ 4, so every N above ~32 looks compute-bound on paper; the real (L1) bottleneck needs hardware counters macOS doesn't expose publicly.
- **Threading:** `rayon-ikj` at N=1024 reaches 7.2× on 8 threads (90%) and 7.6× on 10; `static-ikj` drops from 7.4× to 5.7× going from 8 to 10 threads (E-core stragglers under a fixed row split — a real result, not noise).

## What PR #20 Changed

PR #20 (`feat/csv-timing-columns`) landed before this work starts and changes what it builds on:

- One CSV record per measurement. `median_ms`, `min_ms`, `stddev_ms` and `gops` are end-to-end on every row, including Metal, so `gops` means the same thing everywhere.
- `gpu_ms` (Metal rows only) replaces the `<kernel>-e2e` records; `setup_ms` (every row) times building the kernel.
- `withEndToEnd` is deleted from `web/src/lib/derive.ts`; the dashboard reads rows as the CSV writes them.
- `data/build.sql` requires `setup_ms` and rejects `gpu_ms` on the wrong backend.
- The run data was regenerated in the new schema, so re-query every number in [Findings](#findings-from-the-analysis) before quoting it.

## Pipeline Facts (as of `main` c4e610b)

- `data/build.sql` (DuckDB CLI, `just data`) validates `data/runs/**/*.csv` and writes `web/public/results.json`, an array of row objects. JSON has no NaN/Infinity, so non-finite doubles are written as null. There is no DuckDB in the browser any more.
- `web/src/lib/db.ts` `loadRows()` fetches `results.json`; `web/src/lib/state.svelte.ts` `boot()` loads once; everything downstream is synchronous TypeScript.
- Charts are pure functions `(rows, filters, ctx) → Plotly JSON | null` in `web/src/lib/charts/`, each with a `bun test` suite. Tabs and panels are registered in `web/src/lib/charts/index.ts` (`TABS`); `rowsForTab` is the single place rows are scoped.
- `Ctx` (`web/src/lib/charts/types.ts`, `makeCtx`) is built once from all rows: palette, family map, single-block-size kernels. A peaks lookup would join it.
- Families come from the rows (`families()` in `derive.ts`): `metal` → gpu, `amx` → amx, multi-thread rows → parallel, else serial.
- Colours: charts that cross families use `FAMILY_INK` (validated on all pairs); per-kernel charts use one colour group. `REFERENCE_INK` is the muted rule colour. Never add a hue by eye (`web/src/lib/palette.ts` explains why).
- The JSON writes `timestamp` in the build machine's local timezone (e.g. `"2026-09-24 01:37:09+03"`). Harmless today; matters if a chart ever displays timestamps.

## Noticed in Passing (not in scope)

- README's presets table says `configs/block-sizes.toml` pins sizes 512/1024/2048, f32 and the tiled kernels; the file only pins `block-size = [512, 1024, 2048]`.
- Measurement noise on this M1 Pro: 8+ thread medians swing about ±15% in the daytime (background contention) and 2–5% at night; compare `min_ms` for small-N, 8+ thread configurations.

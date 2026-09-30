# Dashboard HPC Metrics: % of Peak, Optimization Ladder, Accuracy vs Throughput

- **Status:** Approved (2026-09-30). Continues `docs/superpowers/sendoff/2026-09-30-dashboard-hpc-metrics.md`, whose decisions stand except where this spec says otherwise.
- **Branch:** `feat/dashboard-hpc-metrics`
- **Builds on:** PR #20 (`feat/csv-timing-columns`): `gops` is end-to-end on every row, Metal rows carry `gpu_ms`.

## Problem

The dashboard lists results but argues nothing. A reader skimming it for a portfolio sees GOP/s numbers without a denominator (how close to the hardware is 197 GOP/s?), without the headline (how much did each optimization buy?), and without the accuracy half of the precision story (f16 `mps` is as fast as f16 `accelerate-bnns` and about 130× more accurate).

## Goals

1. **% of peak.** Dashed hardware-peak ceilings on the Overview "Throughput by family" chart and the GPU tab's "GPU kernels vs CPU" chart, and `· NN% of peak` in their hover readouts. GOP/s stays the unit.
2. **Optimization ladder.** A new first panel on the Overview: the fastest result of each rung from `naive-ijk` to the GPU, with the multiplier each step buys.
3. **Accuracy vs throughput.** A new scatter on the Precision tab: mean relative error against GOP/s for every float kernel at the selected size.

## Non-Goals

- P-core/E-core-aware parallel efficiency, latency at small N, GFLOP/s per watt (sendoff future items 4–6).
- Claim-style panel titles, and reframing the Block size tab.
- A per-row, thread-scaled peak (`peak × min(threads, cores)`). Every in-scope chart plots a family or a GPU kernel, and hover % is against the drawn ceiling, so nothing would call it. Add it with the first per-kernel % chart.
- Peaks for AMX (no published figure) and the integer precisions (no well-sourced figure). Those families and precisions get no ceiling.
- Telling 14-core and 16-core M1 Pro GPUs apart. Both report `device = "Apple M1 Pro"`; the peaks file lists the 16-core part, the one these runs used. A contributor with the 14-core GPU would be measured against the wrong ceiling. That is a known limit, not something this spec works around.

## Design

### `data/peaks.csv`

Hand-curated hardware peaks, one row per ceiling:

| Column | Type | Meaning |
| :--- | :--- | :--- |
| `device` | VARCHAR | Matches the run files' `device` string. |
| `backend` | VARCHAR | `cpu` or `metal`. |
| `precision` | VARCHAR | Matches the run files' `precision`. Only float precisions have rows today. |
| `cores` | BIGINT | Cores the ceiling assumes are busy: P-cores for `cpu`, GPU cores for `metal`. |
| `gflops` | DOUBLE | The ceiling, in GFLOP/s, at that core count. |
| `source` | VARCHAR | The derivation and a citation for every factor in it. |

One complete ceiling per row, rather than a per-core rate multiplied up, because the P-core clock depends on how many cores are busy. The M1 Pro's two 4-core P-clusters each run at 3.228 GHz with one core active and 3.036 GHz with three or four, so the 8-core ceiling is 8 × 32 × 3.036 = 777 GFLOP/s, not 8 × 103 = 826.

Values for this machine (Apple M1 Pro, 8 P + 2 E cores, 16-core GPU):

| Backend | Precision | Cores | Derivation | GFLOP/s |
| :--- | :--- | ---: | :--- | ---: |
| cpu | f16 | 1 | 4 FMA pipes × 8 lanes × 2 FLOP × 3.228 GHz | 206.592 |
| cpu | f16 | 8 | 8 × 4 × 8 × 2 × 3.036 GHz | 1554.432 |
| cpu | f32 | 1 | 4 × 4 lanes × 2 × 3.228 GHz | 103.296 |
| cpu | f32 | 8 | 8 × 4 × 4 × 2 × 3.036 GHz | 777.216 |
| cpu | f64 | 1 | 4 × 2 lanes × 2 × 3.228 GHz | 51.648 |
| cpu | f64 | 8 | 8 × 4 × 2 × 2 × 3.036 GHz | 388.608 |
| metal | f16 | 16 | 16 cores × 128 ALUs × 2 FLOP × 1.296 GHz; f16 runs at the f32 rate on M1-family GPUs | 5308.416 |
| metal | f32 | 16 | 16 × 128 × 2 × 1.296 GHz | 5308.416 |

Sources:
- **Firestorm FMA pipes:** Dougall Johnson's Firestorm tables, https://dougallj.github.io/applecpu/firestorm.html
- **P-core clocks per active core count:** AnandTech, https://www.anandtech.com/show/17024/apple-m1-max-performance-review
- **GPU ALUs, clock and the f16 rate:** Philip Turner, https://github.com/philipturner/metal-benchmarks

Spec aggregators (e.g. cpu-monkey) list the M1 Pro GPU at 10.6 TFLOP/s f16, twice the f32 rate. Microbenchmarks show f16 FFMA at the f32 rate on M1, so the file uses the same rate.

Memory bandwidth (200 GB/s) is not recorded: a roofline would not help here (sendoff, Findings).

### `data/build.sql`

Before either `COPY`, so a failed build writes neither JSON file:

1. Read `data/peaks.csv` with pinned types, like the run files.
2. Fail the build, naming the offending rows, when any row:
   - is missing a value, or has an empty or blank `source`
   - has a `backend` other than `cpu` or `metal`
   - has `cores ≤ 0`, or a non-finite or non-positive `gflops`
   - shares its `(device, backend, precision, cores)` with another row
   - matches no run row on `(device, backend, precision)`. This catches a typo in a device or precision name, which would otherwise draw no ceiling without any error.

Unlike run files, `peaks.csv` is hand-curated, so a bad value fails the build instead of becoming null.

After the run COPY, write `web/public/peaks.json`: an array of `{device, backend, precision, cores, gflops, source}`. It is generated, so it is gitignored like `results.json`. The lefthook `data-build` hook also fires on `data/peaks.csv`.

### Dashboard data

- `db.ts`: a `Peak` type and `loadPeaks()`, fetched beside `results.json`. `boot()` loads both at once. A missing `peaks.json` is an error, like a missing `results.json`: `just data` always writes both.
- `derive.ts`: `familyPeak(peaks, family, device, precision)` owns the rule:
  - serial → the `cpu` row with `cores = 1`
  - parallel → the `cpu` row with the most cores, if that is more than 1
  - gpu → the `metal` row with the most cores
  - amx → none
- `Ctx` gains `peaks: Peak[]`; `makeCtx(allRows, peaks = [])`, so a chart without peaks behaves exactly as today.

### Ceilings and hover % (Overview, GPU tab)

- **One dashed line per family that has a ceiling:**
  - drawn in `FAMILY_INK`, with a direct label in `LABEL_INK` at the line's left end: "1-core peak", "CPU peak (8 P)", "GPU peak"
  - a layout shape, so it takes no hover and no legend entry of its own
  - in the legend group of the series it belongs to, so hiding that series hides its ceiling. On the GPU tab, the GPU ceiling spans three kernel series and so belongs to no group.
- **Where:** `throughputByFamily` draws the serial, parallel and GPU ceilings. `gpuKernels` draws the GPU and "parallel CPU" ceilings.
- **One device per ceiling:** a family's ceiling is taken from the device and precision of the rows it plots. If they span more than one device, as contributed data from several machines can, that family gets no ceiling.
- **Hover:** `· NN% of peak` against that family's drawn ceiling, to 2 significant figures (`24%`, `0.045%`). No ceiling, no percentage, so the number and the picture always agree.
- **Colour:** the GPU ceiling shares its red with `mps` (both are slot 8). The dash and the label keep them apart.
- **Axis range:** Plotly's autorange includes shapes, so a ceiling above every point stays in view.

### Optimization ladder (Overview, first panel)

- **Rungs,** in fixed effort order, never sorted by speed: `naive-ijk` → serial (excluding `naive-ijk`) → parallel → amx → gpu. A rung with no rows is left out (i32 and i64 have no AMX, f64 has no GPU).
- **Size:** N is the largest size at which every present rung has a row. Each rung's value is its best `gops` there.
- **Hidden when:** there are fewer than two rungs, or no common N. `null` hides the panel.
- **Bars:**
  - horizontal, on a log GOP/s axis, in reading order top to bottom, `naive-ijk` first
  - `naive-ijk` in `BASELINE_INK`, the other rungs in `FAMILY_INK`
  - each bar's text names the winning kernel, its GOP/s and its multiplier over the rung above, e.g. `ikj · 25.7 GOP/s · ×49`
  - a multiplier below 1 is shown as it is, never reordered
- **Total:** carried by an annotation inside the plot, e.g. `0.524 → 3,436 GOP/s · 6,600× at N = 4096`. The panel title is static, and the N shown is derived, not picked.
- **Controls:** the ladder follows the precision pill. No new controls.

### Accuracy vs throughput (Precision tab, second panel)

- **Which rows:** rows at the selected N and precision f16, f32 or f64. Each (kernel, precision) is represented by its fastest row (`bestPerKernel`), keeping only points with `typeof mean_rel_error_f64 === "number" && mean_rel_error_f64 > 0`.
- **`bestPerKernel` fix:** its key gains `precision`, as `bestPerFamily` already has. Without it, the Precision tab, which passes every precision at once, would merge a kernel's f16, f32 and f64 rows into one point. Every other caller is scoped to one precision, so for them nothing changes.
- **Axes:** x is the error on a log axis with power-of-ten ticks; y is GOP/s, log.
- **Encoding:** colour is the family (`FAMILY_INK`), marker shape is the precision (f16 circle, f32 square, f64 diamond).
- **Traces:** one per (family, precision), grouped in the legend under a family title, and each entry toggles only its own points. Hover is `closest`.
- **What's left out, and why:**
  - exact results (error 0): every integer kernel, and every f64 CPU kernel, since they add in the reference's order
  - non-finite results (null in `results.json`)
  - both because a log axis can't show them; the panel note says so
- **The f64 point:** `accelerate-blas` at about 3e-18 is kept, even though it stretches the x-axis across 16 powers of ten. It is the true f64 result.
- **What it shows at N = 4096:** f16 `mps` (0.013%, accumulates in f32) against f16 `accelerate-bnns` (1.7%) at similar GOP/s; the f16 CPU kernels (6.6%) and Metal shaders (6.7%) that accumulate in f16; f32 kernels near 3e-7.

### Tab registry

- **Overview:** ladder, then "Throughput by family", then "Fastest kernel per size".
- **Precision:** "Throughput by precision", then the scatter. The scatter can show the Precision tab on data with one precision, since a tab is present if any of its panels builds. That is intended.
- **Panel notes** for the two ceiling charts gain a sentence on the dashed lines.

## Testing

`bun test`, next to each chart:

- **`familyPeak`:** the family rule, AMX, an unknown device, an integer precision, and a CPU with only a 1-core row (parallel gets no ceiling).
- **`bestPerKernel`:** keyed by precision.
- **Ceilings:**
  - the families that get one, their ink, dash and label
  - no ceiling without peaks, for AMX, or for integers
  - no ceiling when a family spans two devices
  - the legend group
  - the hover % text, including 2 significant figures on a tiny value
- **Ladder:**
  - rung order and the choice of N
  - fewer rungs at f64 and i32
  - a multiplier below 1
  - `naive-ijk` not counted as the serial rung
  - the total annotation
  - the null cases
- **Scatter:**
  - exact, null and integer rows dropped
  - one point per (kernel, precision)
  - symbol per precision, ink per family
  - `f.n` pins the size
  - legend grouping

`build.sql` has no test harness. Each rejection case is run by hand against a scratch copy (see the plan), and the adversarial-reviewer agent reviews the SQL.

Visually: Playwright screenshots of Overview at f32/f16/f64/i32, the GPU tab, and Precision at N = 4096 and 1024, with the plotted numbers checked against DuckDB queries over `results.json`.

## Docs

- **README:** `peaks.csv` under Benchmark Data, `peaks.json` in the `just data` row and the hooks table, and the three features in the Web Dashboard paragraph.
- **CLAUDE.md:** one gotcha: `peaks.csv` is hand-curated, every row needs a source, bad values fail the build.
- **`.claude/agents/dashboard-designer.md`:** its data-source line.

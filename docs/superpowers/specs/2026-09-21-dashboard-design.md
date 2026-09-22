# Benchmark Dashboard

- **Status:** Proposed
- **Builds on:** `gops` column rename (#8), the DuckDB-WASM skeleton in `web/`

The dashboard that turns `web/public/results.parquet` into the charts a reader
actually needs. Scope is `web/` only: no kernel, CLI, or schema changes.

## Problem

- **The dashboard is a table.** `App.svelte` renders every column of one
  `(precision, n)` slice. Nothing shows a trend, and the findings that matter —
  cache-locality collapse, the rayon/static crossover, the GPU handoff — are
  invisible in a sorted list.
- **The mockup is mostly unbacked.** `docs/design/Dashboard-html/` has five tabs.
  Two (Apple AMX, Efficiency) have no data behind them at all, a third (GPU) is
  half unbacked, and its series name kernels that do not exist
  (`matrixmultiply`, `NEON SIMD`). Its precision toggle offers only f32/f64,
  omitting the i64 result that is among the most interesting in the dataset.
- **Coverage is ragged and will stay that way.** Floats stop at N=1024, `mps`
  has no f64/i32/i64 and stops at N=1024, `block_size` has one value. Runs
  contributed from other machines will always be partial, so a dashboard that
  assumes a full cross-product breaks on the second contributor.
- **The mockup's series palette is not legible.** Validated against our dark
  surface it fails four of five checks, including a normal-vision separation of
  ΔE 10.4 between two of its lines — below the 15 floor, so no reader can tell
  them apart.

## Principle: charts are queries, not fixtures

Every panel, tab, control value, and legend entry is derived from the rows
present. Nothing is keyed to a kernel name. A kernel added later appears in the
charts it qualifies for without a code change; a kernel never run leaves no
trace. This is why there is no "Apple AMX" tab: an `accelerate` kernel is
another line in the existing charts, not a new section.

## Data Layer

`results.parquet` is 24 KB / 677 rows, and every row is a distinct
`(kernel, precision, n, threads)` — nothing needs aggregating.

- **One query at boot.** `SELECT * FROM results` into memory. Everything
  downstream is a synchronous `$derived` over that array: no per-chart round
  trips, no loading states after boot, no async empty-state races.
- **DuckDB stays.** It decodes the parquet and is the escape hatch when the
  dataset outgrows memory. At that point the single `SELECT *` becomes a
  filtered query and no chart code changes. See *Growth Thresholds*.
- **A chart is a function.** Observable Plot makes a chart a config object, so
  the catalogue is spec builders plus one renderer:

  ```ts
  type ChartSpec = (rows: Row[], f: Filters) => PlotOptions | null;
  ```

- **Returning `null` is the guard.** A chart that cannot be built from the
  current rows says so in its return type. `<Chart spec={throughputVsSize} />`
  renders the plot or the empty state. No `if (data.length)` scattered through
  markup, no per-chart special-casing for `mps` under f64.
- **A tab is present iff any of its charts returns non-`null`.**
- **Family derives from data, not names:** `backend = 'metal'` → gpu, else
  `max(threads) > 1` per kernel → parallel, else serial. Verified against the
  current rows: the three serial kernels have only `threads=1`; the four
  parallel ones have 1–10. A `kernel LIKE 'rayon%'` heuristic would break on the
  first kernel named differently.

### Files

| File | Responsibility |
|---|---|
| `web/src/lib/db.ts` | existing DuckDB wrapper, unchanged |
| `web/src/lib/data.ts` | boot load, facets, family derivation, defaults |
| `web/src/lib/charts.ts` | the chart spec builders |
| `web/src/lib/palette.ts` | fixed kernel→slot colour map |
| `web/src/lib/Chart.svelte` | renders a spec, or the empty state when `null` |
| `web/src/App.svelte` | tabs, control bar, table view |
| `web/biome.json` | disables `noUnusedVariables` for `.svelte` |

`biome.json` is not incidental: Biome parses only the `<script>` block of a
`.svelte` file, never the template, so every prop and `$derived` used only in
markup is reported unused. Two such false positives already exist in
`App.svelte` (`columns`, `fmt`). Across the chart components this would make
`just lint` noise people learn to scroll past.

## Chart Catalogue

The schema admits six meaningful (x-axis, series) pairings. The rest of the
space is either a re-projection of one of these or has no data behind it.

| # | x | series | Verdict |
|---|---|---|---|
| 1 | `n` | `kernel` | **O1** — headline |
| 2 | `threads` | `kernel` | **T1** |
| 3 | `threads` | `n` | **T2**, as efficiency % |
| 4 | `precision` | `kernel` | **P1** |
| 5 | `n` | `precision` | cut — ordering is stable across N; P1 says it in one frame |
| 6 | `n` | `threads` | cut — #3 transposed, and #3 asks the better question |

**Kernel comparisons use each kernel's best configuration** —
`max(gops) GROUP BY kernel, n` — with the thread count in the legend
(`rayon-ikj · 10T`). Pinning a thread count instead would drop `naive-ijk`,
`ikj` and `tiled` from any chart that compares kernels, since serial kernels
only ever have `threads=1` rows. Charts with `threads` on the x-axis pin
nothing; only T2 pins a kernel.

### Overview

**O1 — Throughput vs matrix size.** x `n` log₂ with ticks at actual values;
y `gops` log, because the range spans 0.35 → 995 and a linear axis would flatten
everything under 100. One series per kernel, legend toggles visibility. A
y-projection toggle switches between absolute GOP/s and × vs `naive-ijk` — the
same query, a second denominator, not a second panel. Projection state is
per-chart, not shared across panels or persisted across tab switches. A ±`stddev_ms` band
converted to GOP/s renders always and self-hides: under 1% at N≥512, about 11%
at N=64, which is exactly where a reader should see it.

*Guard:* ≥2 distinct `n` for ≥1 kernel. The speedup projection is unavailable
when no `naive-ijk` rows exist (`--kernel ikj,rayon-ikj` produces such a set).

**O2 — Fastest kernel per size.** One cell per `n`, labelled with
`arg_max(kernel, gops)` and its value. It makes the CPU→GPU handoff a discrete
visible event rather than something inferred from crossing lines. Computed over
all kernels, independent of O1's legend toggles — it summarises the data, not
the current view. (The mockup coupled it to visible series, which ties two
panels' state together for no gain.)

**O3 — Serial kernels only.** The O1 component preset to `family = 'serial'`,
with its own title and annotation. Not a new chart type. It earns a panel
because in O1 these three sit at the bottom of a 500× range, visually crammed
against the axis; filtered alone they rescale and the cache-locality story
becomes the whole frame. Discovery matters — nobody finds this by unchecking
five legend entries.

### Threading

**T1 — Throughput vs thread count.** x `threads` **linear** — 1, 2, 4, 8, 10 are
unevenly spaced and that is honest, 8 and 10 *are* close. y `gops` **linear**,
because the range is ~50–400 and linear renders the departure from ideal as
visible curvature where log would straighten it. Series per parallel kernel.
y-projection toggle to speedup vs 1 thread, which adds a dashed `y=x` ideal
line.

This panel carries the dataset's strongest finding:

```
f16, N=1024      1T     2T     4T     8T    10T
rayon-ikj       52.9  103.3  199.5  308.5  394.1
static-ikj      52.8  103.0  199.9  391.9  304.8
```

Identical through 4 threads, inverted after. Static partitioning wins at 8 (all
P-cores, no stealing overhead) and loses at 10, where its equal chunks make
every thread wait for the two E-core stragglers that rayon's work-stealing
absorbs. Annotate the 1-thread points against serial `ikj` (52.9 / 52.8 / 52.5):
near-identical, which is the evidence that the thread pools add no single-thread
overhead.

*Guard:* ≥2 distinct `threads` for ≥1 kernel. The speedup projection is
unavailable when no `threads=1` row exists for the plotted kernels.

**T2 — Parallel efficiency.** x `threads` linear; y `speedup / threads × 100`
capped at 100. Its pinned kernel defaults to the best-performing parallel kernel
for the selected precision. One series per `n`, on a sequential ramp rather than the
categorical palette, because `n` is ordinal. Answers where threading stops
paying as the problem shrinks.

### Precision

**P1 — Throughput by precision.** x `precision` categorical, ordered by
descending best throughput; y `gops` linear, grouped bars, series per kernel.
Projection toggle between absolute and relative to f32. The precision pill group
is **inert on this tab** — precision is the x-axis here, and a global control
that silently does nothing is a bug.

Best-in-class today: f16 995 → f32 738 → i32 179 → f64 97.5 → i64 45.5.

### GPU

*Tab guard:* any row with `backend = 'metal'`.

**G1 — GPU vs CPU.** x `n` log₂, y `gops` log. Three series: `mps`, the best
parallel CPU result at each `n`, and the best serial result at each `n` — one
line each, maxed across kernels, not one line per kernel. Crossover annotated.

`mps` renders **dashed**, and this is not decoration: its timed region is
`commit` → `waitUntilCompleted` only, so buffer copies and command encoding are
excluded. It is a kernel-only number being plotted against CPU wall time, and
the caption must say so. The same fact is why the mockup's dispatch/upload/
kernel/download breakdown can never be built — three of its four segments are
never measured.

**G2 — GPU/CPU ratio.** One line, `mps ÷ best_cpu`, log y, reference line at
1.0. Both precisions cross between N=256 and N=512:

```
f32:  0.10  0.20  0.67 │ 3.81  3.32
f16:  0.12  0.17  0.55 │ 1.28  2.53
        64   128   256 │ 512  1024
```

## Controls and Defaults

Controls are **declared per tab** and rendered into a shared bar, rather than a
fixed global bar that would show an N selector on Overview where nothing
consumes it.

| Tab | Declares |
|---|---|
| Overview (O1–O3) | precision |
| Threading (T1) | precision, n |
| Threading (T2) | precision, kernel |
| Precision (P1) | n — its precision pills are inert |
| GPU (G1–G2) | precision, restricted to what `mps` has |

**Defaults.** Precision prefers `f32` when present, falling back to the
widest-coverage precision. N defaults to the largest size available *for the
selected precision*.

**Unavailable values are disabled with a reason, not hidden** — "no f32 runs at
N=2048" on hover. Which combinations have been measured is itself information
for a benchmark dashboard; hiding the gap makes a partial sweep look complete.
Today that is 2 disabled pills of 7 under the float precisions and none under
the integers.

## Theming

Dark only, matching `docs/design/`. Surfaces, ink, type and radii are taken from
the mockup unchanged: page `#0e1012`, panel `#15181b`, border `#24292e`, primary
ink `#e6e3dc`, muted `#9aa1a8`, accent `#e8743b`, IBM Plex Sans for prose and
IBM Plex Mono for numbers and headings, radii 10/8/6/16px.

**The mockup's series colours are replaced.** Validated against panel `#15181b`
they fail the lightness band, the chroma floor, CVD separation
(`#f0a070`↔`#d9c35a` ΔE 4.9 deutan) and — decisively — the normal-vision floor
at ΔE 10.4, below the 15 minimum. The mockup got away with it because its
fictional data never put those two series in one frame.

The validated categorical slots pass every check against our surface (worst
adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3, all eight ≥3:1
contrast). Kernels are assigned in fixed order, arranged so the most-compared
pairs land on adjacent slots, which are the validated worst case:

| Kernel | Slot | Dark |
|---|---|---|
| `naive-ijk` | 1 blue | `#3987e5` |
| `ikj` | 2 orange | `#d95926` |
| `tiled` | 3 aqua | `#199e70` |
| `rayon-ikj` | 4 yellow | `#c98500` |
| `static-ikj` | 5 magenta | `#d55181` |
| `rayon-tiled` | 6 green | `#008300` |
| `static-tiled` | 7 violet | `#9085e9` |
| `mps` | 8 red | `#e66767` |

Colour keys off the kernel name, never its rank in the filtered result, so
hiding a series never repaints the survivors.

**Marks:** 2px lines, ≥8px markers, recessive grid and axes, legend on every
multi-series panel and direct labels on those with ≤4 series, so identity is
never colour-alone. Crosshair-and-tooltip on every line chart. **Dashes are
reserved** for `mps` and for reference lines (ideal-linear, ratio=1.0) — never
for kernel identity, which would collide with the timing caveat.

**A table view per tab** is the accessibility fallback. `App.svelte`'s existing
table becomes exactly that, demoted from "the app" to "the tab's data view."

## Testing

Because charts are pure functions over plain arrays, the testable surface needs
no DuckDB, no DOM, no Svelte harness, and no new dependency. `bun test` is
already the configured script; the justfile's
`# No test-web: bun test fails with no test files in web/` comment is deleted
and `test: test-bench test-web` becomes real, which wires it into CI and
lefthook.

**Fixtures are hand-written, not sliced from the parquet.** The real dataset is
too complete to exercise the guards — the interesting cases are absences. The
fixtures are small arrays with deliberate holes: no `mps`, no `naive-ijk`, no
`threads=1`, a precision with a single size.

| `data.test.ts` | `charts.test.ts` |
|---|---|
| family derivation: metal→gpu, multi→parallel, single→serial | every guard returns `null` on insufficient rows |
| cross-filter: sizes available per precision | GPU tab absent when no `metal` rows |
| defaults: prefers f32, falls back, N = largest for that precision | speedup projections absent without their baselines |
| best-per-kernel argmax, including ties and empty groups | best-per-kernel keeps serial kernels in O1 |

**Not tested:** Svelte rendering (a DOM harness is real dependency weight for
little return), Observable Plot's output (that tests their library), and
theming (the palette validator covers the checkable part).

**Verification:** `just check && just test` before pushing; the browser workflow
on `localhost:5173` — load, read console, screenshot each tab; and a re-run of
the palette validator if any series colour changes.

## Growth Thresholds

- **A ninth kernel.** Eight categorical slots is the hard limit and a ninth
  series may never be a generated hue. The `accelerate` and packed-SIMD specs
  mean this will be reached. Defined overflow: O1 switches to best-per-family —
  three lines on slots 1–3, the only subset that validates under the stricter
  all-pairs list — with kernel-level detail staying on the family tabs. No code
  now; `palette.ts` carries the fixed order and the documented threshold.
- **Dataset size.** When `SELECT *` at boot stops being reasonable, it becomes a
  filtered query behind the same interface. Charts are unaffected.
- **Light mode.** The reference palette supplies validated light steps, so a
  toggle is eight hexes plus surfaces under the documented media-query pattern.

## Out of Scope

Charts that are pure query changes cost one config object each and are defined
here so they appear the moment data exists:

| Chart | Appears when |
|---|---|
| Block size sweep — x `block_size`, series `kernel` | a run uses more than one `--block-size` |
| Host comparison — x `n`, series `host` | a second machine commits runs |

These need new components *and* absent data, and are deferred:

| Chart | Blocked on |
|---|---|
| Regression over time — x `timestamp` | `commit` is `unknown` in every row |
| Share of theoretical peak | no per-device peak figures in the schema |
| Accuracy vs speed | `mean_rel_error_f64` is a hardcoded `0.0` |

Also out of scope: any change to the benchmark crate, the CSV schema, or
`data/build.sql`; filling the coverage holes by re-running sweeps (the design
handles ragged data, so this is a nice-to-have — and its expensive part is the
same `naive-ijk` at N=4096 that costs ~39 minutes per precision).

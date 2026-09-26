# Dashboard: GPU Kernels and Per-Family Colour

- **Status:** Approved in brainstorming (2026-09-25), pending spec review
- **Branch:** `feat/dashboard-gpu-families`
- **Depends on:** PR #16 (`metal-naive`, `metal-tiled`, `-e2e` records) and the `mps` re-run in 8f869a9 that added `mps-e2e` rows.
- **Supersedes:** the GPU section (G1–G2), the Overview O1 series rule, and the "Growth Thresholds → A ninth kernel" item of `2026-09-21-dashboard-design.md`.

## Problem

PR #16 added two GPU kernels and a second timing scope, and the dashboard cannot show either.

- **Two new kernels are invisible.** All nine palette slots are claimed, and every per-kernel chart filters on `ctx.palette.has`, so `metal-naive` and `metal-tiled` never appear on Overview, Precision, or anywhere else.
- **Grey cells.** They win Fastest-per-size at `i32` from N=512 and at `i64` from N=256, which renders those cells in `UNPALETTED_FILL`.
- **The GPU tab merges everything.** Its `gpu` line is the max over `mps`, both shaders and every `-e2e` label, so it is `mps` at f16/f32 and a shader at i32/i64, with nothing saying which. The `-e2e` rows never win that max, so they appear only in the data table.
- **The comparison is not like-for-like.** CPU kernels are timed host-memory-in to host-memory-out. The plain GPU label excludes the copies; `-e2e` includes them. The dashboard plots the former against CPU wall time. This changes a winner: at f32 N=1024, `mps` GPU-only (2158 GOP/s) beats `accelerate-blas` (1748), and `mps-e2e` (1675) does not.
- **The overflow rule already triggered.** The dashboard spec's growth threshold ("a ninth kernel … O1 switches to best-per-family") was crossed by `accelerate-bnns` and deferred with "no code now".

## Goals

1. Every GPU kernel appears on the dashboard with its own colour.
2. Every chart that compares GPU against CPU uses end-to-end GPU timings; GPU-only timings are shown only as copy overhead.
3. The palette ceiling is removed: charts that cross families use family colours, and per-kernel charts show one colour group at a time.
4. The GPU tab answers three questions: how the GPU kernels compare against CPU and AMX, where each one overtakes the CPU equivalent of the same engineering effort, and what the host copies cost.

## Non-Goals

- A timing toggle (GPU-only vs end-to-end). The overhead panel carries the GPU-only information.
- New validated palette slots. Searched in brainstorming: eleven hues pairwise-distinct on the dark surface is not reachable, and a 12-line chart is unreadable regardless.
- Light theme, Svelte rendering tests, zero-copy Metal buffers (the overhead panel is the evidence for or against that follow-up).
- Schema changes. The timing scope stays encoded as the `-e2e` label suffix.

## Design

### Timing: one row per measurement

A new `withEndToEnd(rows)` in `derive.ts`, called once in `boot()` right after `partitionPlottable`.

- Pairs each `X-e2e` row with the `X` row from the same measurement: equal `X`, `precision`, `n`, `threads`, `block_size`, `host` and `timestamp`.
- Emits one row per pair: the `-e2e` row's fields under `kernel = X`, plus `gpu_ms` = the plain row's `median_ms`.
- A plain Metal row with no `-e2e` partner is **dropped** (no silent fallback to GPU-only timing). Every run since PR #16 records both. Not counted in `store.dropped`, whose message is about unusable values.
- An `-e2e` row with no plain partner is kept with `gpu_ms: null`.
- Non-Metal rows get `gpu_ms: null`, so the data view's columns (read off the first row) are uniform.

Downstream, no `-e2e` label exists: palette, families, pills and charts see one timing per kernel.

### Tabs

A chart draws either **families** (family ink) or **kernels of one colour group** (kernel slots), never kernels from both groups.

| Tab (id) | Controls | Panels | Colour |
|---|---|---|---|
| Overview (`overview`) | precision · `inertBlockSize` | **Throughput by family**; **Fastest kernel per size** | family |
| CPU & AMX (`cpu`, new) | precision, blockSize | **Throughput vs matrix size** (per kernel); **Single-threaded kernels** | kernel (host) |
| CPU threading (`threads`) | unchanged | unchanged | kernel (host) |
| Precision (`precision`) | n · `inertPrecision`, `inertBlockSize` | **Throughput by precision** (per family) | family |
| GPU (`gpu`) | precision · `inertBlockSize` | **GPU kernels vs CPU**; **GPU ÷ CPU at equal effort**; **Copy overhead** | kernel (GPU) + family references |
| Block size (`blocksize`) | unchanged | unchanged | kernel (host) |

Family charts show each family's best configuration, so their tabs set `inertBlockSize` (no pills, no block-size scoping in `rowsForTab`). The flag's doc comment widens from "block size is this tab's x-axis" to "block size is not a dimension of this tab". This deliberately reverses cc5b136, which scoped the GPU tab's CPU references to the selected block size (with no pills shown) to avoid max-of-repeats bias. A family view shows each family's best configuration, the same way `bestPerKernel` already takes the best thread count; current data records `block_size` only for the three tiled kernels (every other kernel is null), so the max runs over a swept parameter, not over repeat runs. The test pinning the old behaviour is replaced (decided in plan review, 2026-09-25).

A shared `bestPerFamily(rows, ctx)` in `derive.ts` (today's `byFamily` in `gpu.ts`, extended to keep the winning row) backs every family chart, so each tooltip can name the winning kernel and thread count.

### Colour

Validated with the dataviz skill's `validate_palette.js`, dark mode, surface `#15181b`. Lines and bars are checked on adjacent pairs in their legend order; the Fastest-per-size strip is checked on all pairs, because whichever family wins can change at any size.

**Family ink** (moves from `gpu.ts` to `palette.ts`; order serial → parallel → AMX → GPU):

| Family | Before | After |
|---|---|---|
| serial | aqua `#199e70` | purple `#844da2` |
| parallel | yellow `#c98500` | green `#008300` |
| amx | blue `#3987e5` | blue `#3987e5` |
| gpu | red `#e66767` | red `#e66767` |

The old set fails all-pairs: parallel yellow ↔ GPU red is normal-vision ΔE 13.0, under the hard floor of 15, and it is exactly the pair that meets at the `i32` crossover. `{blue, green, red, purple}` is the only all-pairs-passing set of four that keeps GPU red. New set: all-pairs worst CVD ΔE 8.6, normal-vision 17.8; adjacent in legend order 19.2 / 29.0; all ≥ 3:1 contrast.

**Kernel slots, two groups.** A kernel's slot is unique within its group; groups may reuse slots.

| Group | Kernel | Slot |
|---|---|---|
| host (serial, parallel, amx) | every existing kernel | unchanged |
| host | *(free — was `mps`)* | 8 red |
| gpu | `metal-naive` | 2 orange `#d95926` |
| gpu | `metal-tiled` | 7 violet `#9085e9` |
| gpu | `mps` | 8 red `#e66767` |

GPU-tab legend order is `metal-naive`, `metal-tiled`, `mps`, AMX reference, parallel reference. Five-series panel: worst adjacent CVD ΔE 19.2, normal-vision 22.5. Three-series panels: 19.5 / 22.5. All ≥ 3:1. `metal-*` never takes a family ink, so on the GPU tab a reference line never shares a hue with a kernel.

Cost, accepted: orange is `ikj` on host tabs and `metal-naive` on the GPU tab; violet is `static-tiled` and `metal-tiled`; purple and green are both a host kernel and a family. Identity is never colour-alone: legends everywhere, direct labels at ≤ 4 series, kernel names inside Fastest-per-size cells.

`paletteFor` takes the family map (already built in `makeCtx`) and assigns documented slots per group; an unknown kernel fills a free slot of its own group, and a group that runs out still never gets a generated hue. `UNPALETTED_FILL` becomes unused and is deleted.

**Dashes** are now reserved for reference rules only (ideal-linear, ratio = 1.0). The dashed-`mps` split in `overview.ts` is deleted: no chart plots GPU-only timing against CPU any more.

### Charts

**Overview — Throughput by family.** Today's `gpuVsCpu`, moved and made solid: x `n` log₂, y GOP/s log, one line per family, direct labels (four series), tooltip naming the winning kernel and thread count, `breakGaps` for missing sizes.

**Overview — Fastest kernel per size.** Unchanged except the fill: winner's family ink. Cell text stays `kernel\nGOP/s`, legend is the families present. With the current data the strip reads:

```
f16  bnns ×6 → mps (4096)
f32  blas · bnns ×2 · blas ×2 → mps (2048, 4096)
i32  rayon ×3 → metal-tiled (512+)
i64  rayon ×2 → metal-* (256+)
```

**CPU & AMX — Throughput vs matrix size.** Today's `throughputVsSize` restricted to non-GPU families; keeps the ±1 stddev band, the `× vs naive-ijk` projection and ≤ 4-series labels. **Single-threaded kernels** moves here unchanged.

**Precision — Throughput by precision.** Grouped bars as today, one bar per family (best at the selected N) instead of per kernel. The `i32`/`i64` groups have a GPU bar and no AMX bar.

**GPU — GPU kernels vs CPU.** x `n` log₂, y GOP/s log. Lines for each GPU kernel plus two references: best parallel-family and best AMX-family row at each N, in family ink, labelled "parallel CPU" and "AMX". All solid, `breakGaps`. Tooltips name the kernel; for a reference, the winning kernel and thread count. At `i32`/`i64` there is no AMX or `mps` row, leaving three series with direct labels.

**GPU — GPU ÷ CPU at equal effort.** Log y, dashed rule at 1.0. One line per GPU kernel, in its kernel colour, divided by the best row of its counterpart family at the same N. `COUNTERPART = { mps: "amx" }` is a named constant in `gpu.ts`, default `"parallel"`: hand-written GPU against hand-written parallel CPU, vendor GPU against vendor CPU. Nothing in the data distinguishes a vendor library (`backend` is `metal` for all three), which is why this is keyed by name, the same trade `BASELINE_KERNEL` makes. A size with no counterpart row produces no point. Tooltip: `<kernel> ÷ <counterpart kernel> · <threads>T\n<ratio>×`. Expected values:

```
            512    1024   2048   4096
f32 naive   0.98   1.53   1.59   1.68
f32 tiled   1.43   2.53   3.57   3.48
f32 mps     0.36   0.96   1.55   1.60    (÷ AMX)
f16 mps     0.21   0.34   0.79   1.20    (÷ AMX)
i64 naive   2.73   3.92   4.30   4.45
```

**GPU — Copy overhead.** x `n` log₂, y `(median_ms − gpu_ms) / median_ms × 100`, linear, one line per GPU kernel, rows with `gpu_ms` null skipped. Caption: copies grow as N², arithmetic as N³. Expected shape: `metal-*` 0.6–17 %, `mps` 4–22 % (the fastest kernel pays the largest share), falling at the largest sizes.

Every chart keeps the existing convention: it returns `null` when it cannot be built, which hides the panel, and a tab with no buildable panel is hidden.

## Error Handling

- Contributor rows are untrusted: `isPlottable` still runs before `withEndToEnd`, so an unplottable plain row leaves its `-e2e` partner with `gpu_ms: null` (dropped from the overhead panel only).
- Ratios and percentages filter non-finite results, as `gpuRatio` does today; a missing denominator is a gap, never a `NaN` point.
- Negative overhead cannot come from the harness (each repetition's e2e interval contains its GPU interval, and medians preserve that order), so the y scale includes 0 (`zero: true`) but is never clamped there: a negative value in contributed data stays visible.

## Testing

Hand-written fixtures with deliberate holes, following `fixtures.ts`.

| File | Cases |
|---|---|
| `derive.test.ts` | `withEndToEnd`: pair → one row named `X` with e2e timings and `gpu_ms`; unpaired plain Metal row dropped; unpaired `-e2e` kept with `gpu_ms: null`; different timestamps never pair; CPU rows get `gpu_ms: null`. `bestPerFamily` keeps the winning row. |
| `palette.test.ts` | host kernels keep their exact current hexes; `mps` red, `metal-naive` orange, `metal-tiled` violet; an unknown host kernel takes red, an unknown GPU kernel takes a free GPU slot; family ink values; "survivor keeps its colour" and "caps rather than generating" per group. |
| `gpu.test.ts` | kernels + references build; `i32` fixture without AMX/`mps` gives three series; `mps` divides by AMX and `metal-*` by parallel; missing counterpart → no point; overhead from `gpu_ms`; every panel `null` without Metal rows. |
| `overview.test.ts` | family chart builds and names winners; Fastest-per-size fills from family ink only; CPU & AMX size chart draws no GPU kernel. |
| `precision.test.ts` | family bars; the `i32` group has a GPU bar and no AMX bar. |
| `index.test.ts` | tab order; `inertBlockSize` on Overview, Precision, GPU; GPU tab absent without Metal rows; changing the block-size selection does not change GPU-tab rows. |

**Verification:** `just data` (the Parquet is gitignored and must be rebuilt to contain `mps-e2e`), `just check && just test`; then `preview_start dashboard`, walk every tab at `f32` and `i32`, read the console, screenshot Overview and GPU; re-run `validate_palette.js` on the three new sets and match the numbers quoted in `palette.ts`.

## Docs

- `README.md` Web Dashboard section: six tabs (Overview, CPU & AMX, CPU threading, Precision, GPU, Block size); the Relative toggle applies to the CPU & AMX size chart; GPU charts use end-to-end timing.
- `palette.ts` header comment: the two groups, the family-ink validation numbers, and the all-pairs reason for the strip.
- `2026-09-21-dashboard-design.md`: no edit; this spec's header records what it supersedes.

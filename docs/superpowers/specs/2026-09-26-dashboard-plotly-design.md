# Dashboard: Port the Charts from Observable Plot to Plotly.js

- **Status:** Decided in conversation (2026-09-26). Every code block in the plan was compiled, tested and browser-checked in a scratch copy of `web/` before the plan was written.
- **Branch:** `feat/dashboard-plotly`, from `main` at 6c3ce94 (PR #17 merged).
- **Plan:** `docs/superpowers/plans/2026-09-26-dashboard-plotly.md`

## Problem

The dashboard charts with Observable Plot 0.6.17. Plot renders a static SVG plus a pointer tooltip, and nothing else. The Plotly dashboard this repo had before (removed in c5448f6) came with zoom, pan, legend toggling and image export built in. The charts here need exactly those. The CPU & AMX chart draws nine kernels on log–log axes, where hiding a line, isolating one kernel or zooming into a size range is how you read it. Building those on Plot by hand (a clickable legend, d3-brush zoom on log scales, SVG-to-image export) means 200+ lines that recreate Plotly less well. Bundle size doesn't matter here: this is a static page, and the DuckDB wasm it already loads is 34 MB.

Three existing defects surfaced while planning, and the port fixes all three:

- **Charts never fill their panel.** No width is passed anywhere, so Plot renders at its 640px default and only ever shrinks.
- **Threading charts zig-zag.** 588 (kernel, precision, n, threads, block_size) groups hold two runs, e.g. rayon-ikj f16 N=128 at 8 threads is both 32.4 and 129.7 GOP/s. Plot's line mark connects both points.
- **The efficiency ramp is out of order.** Plot sorts an ordinal string domain, so N is coloured in the order "1024" < "128" < "2048" … rather than by size.

## Goals

1. Every chart gets built-in interaction: box zoom, pan, double-click to reset, click a legend entry to hide it, double-click to isolate it, and an SVG download.
2. Line charts show one hover readout that lists every series at the pointer's x. Bar charts show per-bar hover.
3. Charts fill their panel and follow its width.
4. Nothing else changes, beyond the intended changes listed below. Palette hexes, legend orders, line breaks at gaps, direct labels, the null convention and tab visibility all stay as they are.
5. Chart definitions stay pure functions, tested with `bun test` without loading the chart library.

## Non-Goals

- **Changing the UI framework.** Svelte 5 stays. Plotly doesn't depend on a framework.
- **Bundle size, or lazy-loading Plotly.** The bundle grows to 4.9 MB (1.5 MB gzipped).
- DOM tests for `Chart.svelte`, a light theme, and new charts.
- **Relative baselines under repeat runs** (see Out of Scope).

## Design

### Library

Use `plotly.js-dist-min` pinned to exactly `4.1.1`. Plotly 4 ships its own TypeScript types (`lib/index.d.ts`), so `@types/plotly.js` (still on 3.x) isn't needed. Only `web/src/lib/Chart.svelte` imports Plotly at runtime. Every other module uses `import type`, so `bun test` never loads the UMD bundle: the whole suite runs in about 30 ms. Vite 8 bundles the CommonJS entry with a default import and no configuration. `build.chunkSizeWarningLimit` is raised to 6000 kB so the accepted size doesn't produce a warning on every build.

### The figure contract

```ts
type Trace = Partial<ScatterData> | Partial<BarData>;
interface Figure { data: Trace[]; layout: Partial<Layout> }
type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => Figure | null;
```

Figures are plain JSON with no functions, so `Chart.svelte` can `structuredClone` them. The null convention is unchanged: a null still hides a panel, a projection toggle, and a whole tab. `index.ts` (the tab registry, `rowsForTab` and `visibleTabs`), `derive.ts` and `db.ts` don't change.

### Shared builders (`web/src/lib/charts/types.ts`)

- **`BASE_LAYOUT`** sets:
  - height 400 and a transparent paper and plot area;
  - IBM Plex Sans 12px in text ink `#9aa1a8`;
  - margins l64 r24 t8 b44, with the legend in one horizontal row above the plot;
  - `hovermode: "x unified"`;
  - a hover label with background `#15181b`, border `#24292e` and text `#e6e3dc`.

  **`AXIS`** draws grid and axis lines in `#24292e`, with no zero line and `automargin`. **`LABELLED_MARGIN`** widens the right margin to 100 for direct labels.
- **`log2Axis(ticks, title)`** is a log axis ticked at exactly the measured sizes, with integer tick labels and an integer hover header (`hoverformat: "d"`, so the header reads `1024`).
- **`lineTraces(points, { order, color, hovertemplate, xs?, labels? })`** builds one lines+markers trace per series, in legend order. It replaces `breakGaps`:
  - Given shared `xs`, a missing point becomes a null y, and Plotly breaks the line there (`connectgaps` defaults to false).
  - Two points at one (series, x) keep the higher y, the rule `bestPerKernel` applies everywhere else.
  - Lines are 2px and markers 8px, matching Plot's r=4.
  - `cliponaxis: false` lets end labels sit in the margin. Plotly still hides points that fall outside a zoomed range.
  - With `labels`, text appears only at the last x, and only where the series has a point.
- **`uidOf(series)`** encodes every character outside `[A-Za-z0-9-]`, `_` included, as `_<hex>_`. During a redraw, Plotly builds CSS selectors from trace uids (`".cb" + uid`). In the spike, a raw uid `band:ikj` threw a `SyntaxError` inside `Plotly.react` and aborted Svelte's update, which left the previous tab's chart under the new tab's title. `parallel CPU` would silently turn into a descendant selector instead.
- **`escapeLabels(figure)`** escapes `&`, `<` and `>` in trace `name`, `text`, `customdata` and `x`, and in `xaxis.categoryarray`. Plotly renders those strings as a subset of HTML (`<a href>`, `<span style>`). Kernel and precision names come from contributed CSVs, and `data/build.sql` doesn't restrict their characters. Templates are the charts' own and keep their markup.

### The renderer (`web/src/lib/Chart.svelte`)

- **Drawing.** It calls `Plotly.react` on `escapeLabels(structuredClone(spec))`. The clone matters because Plotly writes zoom state back into the layout it's given, and charts share `BASE_LAYOUT`'s nested objects.
- **State across redraws.** `legend.uirevision` is the panel title, so a hidden series stays hidden across filter changes (traces are matched by uid). `layout.uirevision` is left unset, so zoom resets whenever the data changes. Verified: on the Overview, hid `parallel`, box-zoomed, then switched f32 → f64. `parallel` stayed hidden and the x axis returned to autorange.
- **Config.**
  - `displaylogo: false`.
  - `showSendToCloud: false`. Plotly 4 turns this on by default, and the button posts the chart's data to `cloud.plotly.com`.
  - `modeBarButtonsToRemove: ["select2d", "lasso2d"]`.
  - `toImageButtonOptions: { format: "svg", filename: title }`.

  Verified modebar: Download plot, Zoom, Pan, Zoom in, Zoom out, Autoscale, Reset axes.
- **Sizing.** A `ResizeObserver` on the plot div calls `Plotly.Plots.resize`, guarded on the `js-plotly-plot` class because `Plots.resize` rejects on a div Plotly hasn't drawn into. Plotly's `responsive` flag only watches window resizes. In the spike, the page scrollbar that appears once the charts load narrowed every panel by 15px, leaving a 910px SVG inside an 895px panel.
- **Purge in its own effect.** A cleanup inside the draw effect would run before every redraw and discard the state `react` preserves.
- **One Chart per panel.** `App.svelte` keys the panel loop by title, so a `Chart` instance is always one panel. During the port, a panel's div never switches between Plot and Plotly. Verified in a scratch copy with Overview on Plotly and every other tab on Plot: switching tabs raised no errors and left each div with one renderer's output.

### Chart mapping

| Chart | Plot | Plotly |
|---|---|---|
| `throughputByFamily` | line, dot, text, tip | `lineTraces` with labels, `log2Axis`, log y |
| `fastestPerSize` | `Plot.cell` strip | One bar trace per family, `barmode: "stack"` with y = 1, so each size is one full-width cell. Category x, because sizes are strings here and Plotly would otherwise read "64" as a number. `legend.traceorder: "normal"`, because Plotly reverses a stacked chart's legend by default (caught in the browser, not by unit tests). `texttemplate` shows kernel and GOP/s, hover is closest, both axes use `fixedrange`. |
| `throughputVsSize`, `serialOnly` | `areaY` band, lines | One `fill: "toself"` trace per kernel. Each null-separated run of sizes closes on its own, so the band breaks exactly where the line does. It shares the line's `legendgroup`, so hiding a kernel hides both, and uses 15% alpha (hex `26`) with hover skipped. No band in the relative projection. |
| `throughputVsThreads` | lines, ideal line mark | No shared xs: a shorter sweep is not a gap, as before. The ideal line becomes a dashed layout shape, drawn only in relative mode. |
| `parallelEfficiency` | ordinal `YlGnBu` | `sequentialRamp(n)` in `palette.ts`, with sizes in numeric order, y range `[0, ceiling]`, and legend title "N". |
| `throughputByPrecision` | `fx` facets | One bar trace per family, `barmode: "group"`. Category x in best-first precision order. Closest hover. A family missing at a precision keeps its empty slot, as before. |
| `gpuKernels` | lines, labels, tip | The CPU reference lines carry the kernel and thread count behind each point in `customdata`. |
| `gpuEqualEffort` | `ruleY([1])`, merged labels | A paper-wide dashed shape at y = 1. Shape y is in data units even on a log axis: verified, the shape draws at 114.72px and `l2p(log10 1)` at 114.7px. Merged end labels move to a text-only trace (`uid: "labels"`). `tickformat: "~g"`. |
| `gpuCopyOverhead` | `zero: true` | `rangemode: "tozero"`, which includes 0 without clamping negatives. |
| `blockSizeSweep` | lines, labels | `log2Axis(sizes, "Block size")` |

The hover templates put the value first in bold, then the series and details: "values lead, labels follow". For example: `<b>1674.7 GOP/s</b>  mps` and `<b>1.66×</b>  metal-naive ÷ rayon-ikj · 10T`. Markup lives only in templates, and data strings never carry any.

### Intended behaviour changes

1. The interaction in goals 1–3.
2. A single-series chart has no legend. This is Plotly's default, and the dataviz rule says a single series needs no legend box. Plot always drew one.
3. Repeat runs at one (series, x) show the best, so the threading charts no longer zig-zag.
4. The efficiency ramp runs in numeric N order and drops YlGnBu's two darkest stops (`#253494`, `#081d58`), which all but vanish on `#15181b`. With the dashboard's seven sizes that is exactly stops 0–6 (`#ffffd9` … `#225ea8`).
5. Threading direct labels sit at each line's own last point. Before, only lines that reached the highest thread count got one.
6. Reference dashes use Plotly's named `"dash"` (9px) rather than Plot's 5px, because the v4 types accept only named dashes.
7. Log y axes also label 2 and 5 between decades, which is Plotly's default log ticking.

## Testing

- Chart suites read figures through three helpers in `fixtures.ts`: `pointsOf(fig, series)`, `legendOf(fig)` and `plotted(fig)`. They never index traces by position.
- A new `charts/types.test.ts` covers the builders: gaps, own-x mode, repeat runs, order, uid and legend group, labels, the log₂ axis, escaping and uid safety.
- New chart tests cover:
  - the band breaking at a gap;
  - no band in relative mode;
  - stacked legend order and the category axis;
  - both reference shapes;
  - the ramp's numeric order;
  - the kernel behind each reference point.
- Test-file type errors drop from 28 to the 8 pre-existing "cannot find module `bun:test`" lines, one per suite. The last task tightens the type gate to match.
- Browser checks are scripted in the plan. They use JavaScript inspection of the Plotly graph div, and dispatch `mousemove` on `.nsewdrag` for hover, because synthetic pointer moves from the browser tool don't reach Plotly's hover layer.

## Migration

One tab per task. Plot and Plotly coexist behind a temporary two-renderer `Chart.svelte` and a transitional `PlotChartSpec` type. The last task deletes Plot, the transitional types, `breakGaps` and `BASE`.

## Out of Scope (noticed while planning)

- **Relative baselines under repeat runs.** `baselineAt`, `singleThread` and the efficiency baseline take whichever repeat run comes last. Plot behaves the same, and a ratio can be off where two runs disagree. It needs its own decision (best, median, or latest run).
- **`data/build.sql` doesn't validate label characters.** `escapeLabels` makes display safe, but rejecting bad names at the trust boundary would be cleaner.
- **The `dashboard-designer` agent's description is stale.** `.claude/agents/dashboard-designer.md` still describes `web/` as "the unmodified Vite+Svelte starter".

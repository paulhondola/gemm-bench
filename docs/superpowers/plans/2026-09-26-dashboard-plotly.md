# Dashboard Plotly Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Observable Plot with Plotly.js 4.1.1 in the `web/` dashboard, so every chart gets zoom, pan, legend hide and isolate, a readout of every series on hover, SVG export, and a width that follows its panel.

**Architecture:** Chart specs stay pure functions, but now return plain Plotly JSON (`Figure = { data, layout }`). They are built from shared helpers in `charts/types.ts`: `BASE_LAYOUT`, `log2Axis`, `lineTraces`, `uidOf` and `escapeLabels`. `Chart.svelte` is the only file that imports Plotly at runtime. It clones and escapes each figure, calls `Plotly.react`, keeps hidden legend series across redraws with `legend.uirevision`, and follows its panel's width with a `ResizeObserver`. The port goes one tab per task. During it, Plot and Plotly coexist behind a temporary two-renderer `Chart.svelte`, and the last task deletes Plot.

**Tech Stack:** Svelte 5, TypeScript, Plotly.js 4.1.1 (`plotly.js-dist-min`), DuckDB-WASM, `bun test`, Biome 2.5, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-26-dashboard-plotly-design.md`

## Global Constraints

- **Branch.** Work on `feat/dashboard-plotly`, which already exists (from `main` at 6c3ce94). Do not push.
- **Scope.** Touch only `web/**` and `README.md`.
- **Dependencies.** Add `plotly.js-dist-min` pinned to exactly `4.1.1` (Task 1) and remove `@observablehq/plot` (Task 8). No other dependencies.
- **Plotly imports.** Only `web/src/lib/Chart.svelte` imports `plotly.js-dist-min` at runtime. Everywhere else, `import type` only: `bun test` must never load the library.
- **Where commands run.**
  - From `web/`: tests `bun test`, lint `bunx @biomejs/biome check --write <files>`, build `bun run build`.
  - From the repo root: `git`.
- **Type gate, every task:** `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'` prints nothing. (`bun run typecheck` checks no files, and svelte-check has pre-existing errors in `*.test.ts`.) From Task 8 on, the stricter gate is `bun run check 2>&1 | grep ' ERROR ' | grep -v "bun:test"`, which must also print nothing. Keep the spaces in `' ERROR '`: a bare `grep ERROR` also matches svelte-check's summary line (`… COMPLETED 365 FILES 9 ERRORS …`), so it never prints nothing.
- **Hexes, verbatim.**
  - Nothing in `palette.ts`'s existing constants changes.
  - Chart chrome: text ink `#9aa1a8`, grid and axis `#24292e`, hover background `#15181b`, hover text `#e6e3dc`, fastest-cell text `#0e1012`.
  - YlGnBu stops: `#ffffd9 #edf8b1 #c7e9b4 #7fcdbb #41b6c4 #1d91c0 #225ea8 #253494 #081d58`.
- **Legend orders.**
  - Families everywhere: serial, parallel, amx, gpu.
  - GPU tab: `metal-naive`, `metal-tiled`, `mps`, `AMX`, `parallel CPU`.
- **Markup.** `<b>`, `<br>` and `<extra>` appear only in `hovertemplate` and `texttemplate`, never in `name`, `text` or `customdata`. `escapeLabels` escapes those three.
- **Series traces.** Every series trace sets `uid: uidOf(series)` and `legendgroup: series`. Never use a raw name as a uid: Plotly builds CSS selectors from uids.
- **Hover mode.** Line charts use `hovermode: "x unified"` (from `BASE_LAYOUT`). Bar charts set `hovermode: "closest"`.
- **Dashes.** Only reference lines (ideal linear, ratio = 1.0) are dashed, with `dash: "dash"`. The Plotly types reject pixel lists.
- **Code style.**
  - Row fields are read through `Number(...)` / `String(...)`, as the existing code does.
  - Comments say why, not what. Match the surrounding comment style.
- **Commits.** Messages are an imperative sentence with no `feat:` prefix, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never bypass lefthook.
- **Browser checks.**
  - Use the built-in browser: `preview_start` with `{ name: "dashboard" }` (`.claude/launch.json`: `bun --cwd web dev` on port 5173), then navigate to `http://localhost:5173/gemm-bench/`.
  - This needs `web/public/results.parquet`; run `just data` from the repo root if it is missing.
  - Synthetic pointer moves from the browser tool don't reach Plotly's hover layer, so hover checks use the `mousemove` dispatch snippet below.
  - If you have no browser tools, say so in your report instead of claiming the checks passed.

### Browser snippets (used by several tasks)

Run these with the browser's `javascript_tool`.

**TAB_WALK** clicks through every tab and reports each panel's renderer plus any runtime errors:

```js
const errs = [];
addEventListener("error", (e) => errs.push(String(e.message)));
addEventListener("unhandledrejection", (e) => errs.push(`rejection: ${e.reason}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = [];
for (const label of ["CPU & AMX", "CPU threading", "Precision", "GPU", "Block size", "Overview", "GPU", "Overview"]) {
	[...document.querySelectorAll("nav button")].find((b) => b.textContent === label)?.click();
	await sleep(500);
	seen.push(`${label}: ${[...document.querySelectorAll(".panel")].map((p) => {
		const gd = p.querySelector(".js-plotly-plot");
		const kind = gd ? `plotly(${gd._fullData.filter((t) => t.showlegend !== false).map((t) => t.name).join(",")})` : p.querySelector(".plot > *") ? "plot" : "empty";
		return `${p.querySelector("h2").textContent} [${kind}]`;
	}).join(" | ")}`);
}
({ errs, seen });
```

**HOVER** dispatches a pointer move at `fx` of each Plotly chart's width and `fy` of its height (from the top), and returns each chart's hover readout:

```js
const fx = 0.66, fy = 0.5;
const out = [];
for (const gd of document.querySelectorAll(".js-plotly-plot")) {
	const drag = gd.querySelector(".nsewdrag");
	const r = drag.getBoundingClientRect();
	drag.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true }));
	await new Promise((res) => setTimeout(res, 150));
	out.push([...gd.querySelectorAll(".hoverlayer text")].map((t) => t.textContent).filter(Boolean));
}
out;
```

**CHROME** reports the modebar buttons, the Plotly logo, and each chart's container width against its SVG width:

```js
const gd = document.querySelector(".js-plotly-plot");
({
	buttons: [...gd.querySelectorAll(".modebar-btn")].map((b) => b.getAttribute("data-title")),
	logo: !!gd.querySelector(".modebar-btn--logo"),
	widths: [...document.querySelectorAll(".js-plotly-plot")].map((g) => [Math.round(g.getBoundingClientRect().width), Number(g.querySelector(".main-svg").getAttribute("width"))]),
});
```

---

### Task 1: Add Plotly, the figure types, and the shared trace builders

This is additive: Plot still renders everything after this task.

**Files:**
- Modify: `web/package.json`, `web/bun.lock` (via `bun add`)
- Modify: `web/src/lib/charts/types.ts`: a new import at the top, `Trace` and `Figure` after `PlotSpec`, and the helpers appended at the end
- Modify: `web/src/lib/fixtures.ts` (whole file)
- Create: `web/src/lib/charts/types.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, from `web/src/lib/charts/types.ts`:
  - `type Trace = Partial<ScatterData> | Partial<BarData>`
  - `interface Figure { data: Trace[]; layout: Partial<Layout> }`
  - `LABEL_INK: string`, `AXIS: Partial<LayoutAxis>`, `MARGIN`, `LABELLED_MARGIN`, `BASE_LAYOUT: Partial<Layout>`
  - `log2Axis(ticks: number[], title: string): Partial<LayoutAxis>`
  - `uidOf(series: string): string`
  - `interface SeriesPoint { series: string; x: number; y: number; custom: (string | number)[] }`
  - `interface LineOptions { order: string[]; color: (series: string) => string; hovertemplate: string; xs?: number[]; labels?: boolean }`
  - `lineTraces(points: SeriesPoint[], o: LineOptions): Partial<ScatterData>[]`
  - `escapeLabels(fig: Figure): Figure`
- Produces, from `web/src/lib/fixtures.ts`:
  - `interface Point { x: Datum; y: Datum; custom: Datum[] }`
  - `pointsOf(fig: Figure | null, name: string): Point[]`
  - `legendOf(fig: Figure | null): { names: string[]; colors: string[] }`
  - `plotted(fig: Figure | null): (Point & { series: string })[]`
  - `row(fields: Row): Row` (unchanged)

- [ ] **Step 1: Add the dependency**

Run from `web/`:

```bash
bun add plotly.js-dist-min@4.1.1
```

Then check it with `grep plotly package.json`.

Expected: `"plotly.js-dist-min": "4.1.1"` under `dependencies`, an exact pin. `@observablehq/plot` stays for now.

- [ ] **Step 2: Write the failing tests and the test helpers**

Replace the whole of `web/src/lib/fixtures.ts` with:

```ts
import type { Datum } from "plotly.js-dist-min";
import type { Figure } from "./charts/types";
import type { Row } from "./db";

/** A test row; most rows are single-threaded f32 CPU results. */
export function row(fields: Row): Row {
	return { precision: "f32", threads: 1, backend: "cpu", ...fields };
}

export interface Point {
	x: Datum;
	y: Datum;
	custom: Datum[];
}

/**
 * A series' points in x order, gaps included (y null). Found by name, so a
 * test never depends on where a trace sits in the figure.
 */
export function pointsOf(fig: Figure | null, name: string): Point[] {
	const t = fig?.data.find((d) => d.name === name);
	const x = (t?.x ?? []) as Datum[];
	const y = (t?.y ?? []) as Datum[];
	const custom = (t?.customdata ?? []) as Datum[][];
	return x.map((xi, i) => ({
		x: xi,
		y: y[i] ?? null,
		custom: custom[i] ?? [],
	}));
}

/** The series a figure's legend lists, and the colour each is drawn in. */
export function legendOf(fig: Figure | null): {
	names: string[];
	colors: string[];
} {
	const shown = (fig?.data ?? []).filter((t) => t.showlegend !== false);
	return {
		names: shown.map((t) => String(t.name)),
		colors: shown.map((t) => String(t.marker?.color)),
	};
}

/** Every measured point of every legend series, gaps left out. */
export function plotted(fig: Figure | null): (Point & { series: string })[] {
	return legendOf(fig).names.flatMap((series) =>
		pointsOf(fig, series)
			.filter((p) => p.y !== null)
			.map((p) => ({ ...p, series })),
	);
}
```

Create `web/src/lib/charts/types.test.ts`:

```ts
import { expect, test } from "bun:test";
import { legendOf, pointsOf } from "../fixtures";
import {
	escapeLabels,
	type Figure,
	lineTraces,
	log2Axis,
	type SeriesPoint,
	uidOf,
} from "./types";

const ink = (s: string) => (s === "a" ? "#3987e5" : "#d95926");
const p = (
	series: string,
	x: number,
	y: number,
	custom: (string | number)[] = [],
): SeriesPoint => ({ series, x, y, custom });
const fig = (data: Figure["data"]): Figure => ({ data, layout: {} });

test("a series missing a shared x gets a null y there, where Plotly breaks the line", () => {
	const lines = fig(
		lineTraces(
			[
				p("a", 64, 1),
				p("a", 256, 3),
				p("b", 64, 2),
				p("b", 128, 2),
				p("b", 256, 2),
			],
			{ order: ["a", "b"], color: ink, xs: [64, 128, 256], hovertemplate: "" },
		),
	);
	expect(pointsOf(lines, "a").map((q) => q.y)).toEqual([1, null, 3]);
	expect(pointsOf(lines, "b").map((q) => q.y)).toEqual([2, 2, 2]);
});

test("without shared xs a series is drawn over its own x values, ascending", () => {
	const [a] = lineTraces([p("a", 10, 5), p("a", 1, 1), p("a", 4, 3)], {
		order: ["a"],
		color: ink,
		hovertemplate: "",
	});
	expect(a.x).toEqual([1, 4, 10]);
	expect(a.y).toEqual([1, 3, 5]);
});

test("repeat runs at one x keep the best, not a zig-zag through both", () => {
	const [a] = lineTraces(
		[p("a", 8, 32.4, ["run 1"]), p("a", 8, 129.7, ["run 2"])],
		{
			order: ["a"],
			color: ink,
			hovertemplate: "",
		},
	);
	expect(a.y).toEqual([129.7]);
	expect(a.customdata).toEqual([["run 2"]]);
});

test("traces follow the legend order and carry their series as uid and legend group", () => {
	const lines = fig(
		lineTraces([p("b", 1, 1), p("a", 1, 1)], {
			order: ["a", "b"],
			color: ink,
			hovertemplate: "",
		}),
	);
	expect(legendOf(lines)).toEqual({
		names: ["a", "b"],
		colors: ["#3987e5", "#d95926"],
	});
	expect(lines.data.map((t) => [t.uid, t.legendgroup])).toEqual([
		["a", "a"],
		["b", "b"],
	]);
});

test("direct labels name a series only at the last x, and only where it has a point", () => {
	const [a, b] = lineTraces([p("a", 1, 1), p("a", 2, 2), p("b", 1, 1)], {
		order: ["a", "b"],
		color: ink,
		xs: [1, 2],
		labels: true,
		hovertemplate: "",
	});
	expect(a.mode).toBe("lines+markers+text");
	expect(a.text).toEqual(["", "a"]);
	expect(b.text).toEqual(["", ""]);
});

test("the log2 axis ticks exactly the measured sizes, as plain integers", () => {
	const axis = log2Axis([64, 128, 4096], "N");
	expect(axis.type).toBe("log");
	expect(axis.tickvals).toEqual([64, 128, 4096]);
	expect(axis.ticktext).toEqual(["64", "128", "4096"]);
});

test("labels from contributed data render literally, never as Plotly markup", () => {
	const hostile = '<a href="https://x">k</a> & co';
	const safe = '&lt;a href="https://x"&gt;k&lt;/a&gt; &amp; co';
	const out = escapeLabels({
		data: [
			{
				type: "bar",
				name: hostile,
				x: [hostile],
				text: [hostile],
				customdata: [[hostile, 3]],
				hovertemplate: "<b>%{y}</b>",
			},
		],
		layout: { xaxis: { categoryarray: [hostile] } },
	});
	const [t] = out.data;
	expect(t.name).toBe(safe);
	expect(t.x).toEqual([safe]);
	expect(t.text).toEqual([safe]);
	expect(t.customdata).toEqual([[safe, 3]]);
	expect(t.hovertemplate).toBe("<b>%{y}</b>");
	expect(out.layout.xaxis?.categoryarray).toEqual([safe]);
});

test("uids stay valid CSS class names, since Plotly selects by them", () => {
	expect(uidOf("rayon-ikj")).toBe("rayon-ikj");
	expect(uidOf("parallel CPU")).toBe("parallel_20_CPU");
	expect(uidOf("k.v2:x")).toBe("k_2e_v2_3a_x");
	// "_" is encoded too, so a name that looks like an encoding stays distinct.
	expect(uidOf("a_20_b")).not.toBe(uidOf("a b"));
	const [t] = lineTraces([p("parallel CPU", 1, 1)], {
		order: ["parallel CPU"],
		color: ink,
		hovertemplate: "",
	});
	expect(t.uid).toMatch(/^[A-Za-z0-9_-]+$/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/lib/charts/types.test.ts`

Expected: FAIL with `SyntaxError: Export named '<one of escapeLabels, lineTraces, log2Axis, uidOf>' not found in module '.../charts/types.ts'`.

- [ ] **Step 4: Add the types and builders to `types.ts`**

At the very top of `web/src/lib/charts/types.ts`, above `import type { Row } from "../db";`, add:

```ts
import type {
	BarData,
	Layout,
	LayoutAxis,
	ScatterData,
} from "plotly.js-dist-min";
```

Directly after the `PlotSpec` type (before `export interface Filters`), add:

```ts
/** Every chart draws scatter lines or bars. */
export type Trace = Partial<ScatterData> | Partial<BarData>;

/**
 * What a chart hands Plotly: plain JSON, so building and testing a chart never
 * loads the library. Only Chart.svelte imports Plotly at runtime.
 */
export interface Figure {
	data: Trace[];
	layout: Partial<Layout>;
}
```

Append at the end of the file, after `BASE`:

```ts
/** Axis text and direct labels: text ink, never a series colour. */
export const LABEL_INK = "#9aa1a8";

/** Recessive grid and axis lines, in the panel border's ink. */
export const AXIS: Partial<LayoutAxis> = {
	gridcolor: "#24292e",
	linecolor: "#24292e",
	zeroline: false,
	automargin: true,
};

export const MARGIN = { l: 64, r: 24, t: 8, b: 44 };
/** Room for direct labels beside each series' last point. */
export const LABELLED_MARGIN = { ...MARGIN, r: 100 };

/**
 * Transparent on the panel, the legend in one row above the plot, and one
 * hover readout listing every series at the pointer's x. Charts share these
 * nested objects; Chart.svelte hands Plotly a copy.
 */
export const BASE_LAYOUT: Partial<Layout> = {
	height: 400,
	paper_bgcolor: "rgba(0,0,0,0)",
	plot_bgcolor: "rgba(0,0,0,0)",
	font: {
		family: '"IBM Plex Sans", system-ui, sans-serif',
		size: 12,
		color: LABEL_INK,
	},
	margin: MARGIN,
	legend: {
		orientation: "h",
		x: 0,
		xanchor: "left",
		y: 1.02,
		yanchor: "bottom",
	},
	hovermode: "x unified",
	hoverlabel: {
		bgcolor: "#15181b",
		bordercolor: "#24292e",
		font: { color: "#e6e3dc" },
	},
	xaxis: AXIS,
	yaxis: AXIS,
};

/** A log axis ticked at exactly the measured powers of two, as integers. */
export function log2Axis(ticks: number[], title: string): Partial<LayoutAxis> {
	return {
		...AXIS,
		type: "log",
		tickvals: ticks,
		ticktext: ticks.map(String),
		hoverformat: "d",
		title: { text: title },
	};
}

/**
 * A trace uid for a series name. Plotly builds CSS class selectors from uids
 * (".cb" + uid) when it cleans up a redraw, so "band:ikj", "parallel CPU" or a
 * contributed kernel name with a "." would throw or match the wrong nodes.
 * Every character outside [A-Za-z0-9-], "_" included, becomes _<hex>_, which
 * keeps distinct names distinct.
 */
export function uidOf(series: string): string {
	return series.replace(
		/[^A-Za-z0-9-]/g,
		(c) => `_${c.codePointAt(0)?.toString(16)}_`,
	);
}

export interface SeriesPoint {
	series: string;
	x: number;
	y: number;
	/** Hover fields, read by the chart's hovertemplate as %{customdata[i]}. */
	custom: (string | number)[];
}

export interface LineOptions {
	/** The series to draw, in legend order. */
	order: string[];
	color: (series: string) => string;
	/** Markup lives here, never in data strings: escapeLabels escapes those. */
	hovertemplate: string;
	/**
	 * Shared x positions. A series missing one gets a null y there, which is
	 * where Plotly breaks the line (connectgaps defaults to false) instead of
	 * drawing through a measurement nobody took. Omit it to draw each series
	 * over its own x values.
	 */
	xs?: number[];
	/** Name each series beside its point at the last x. */
	labels?: boolean;
}

/**
 * One lines+markers trace per series. Two points at one (series, x), such as
 * repeat runs, keep the higher y: the rule bestPerKernel applies everywhere
 * else. uid and legendgroup follow the series name, because Plotly matches a
 * hidden series across redraws by uid, and a band in the same legend group
 * hides with its line.
 */
export function lineTraces(
	points: SeriesPoint[],
	o: LineOptions,
): Partial<ScatterData>[] {
	return o.order.map((series): Partial<ScatterData> => {
		const at = new Map<number, SeriesPoint>();
		for (const p of points) {
			if (p.series !== series) continue;
			const current = at.get(p.x);
			if (!current || p.y > current.y) at.set(p.x, p);
		}
		const xs = o.xs ?? [...at.keys()].sort((a, b) => a - b);
		const last = xs[xs.length - 1];
		const color = o.color(series);
		return {
			type: "scatter",
			mode: o.labels ? "lines+markers+text" : "lines+markers",
			name: series,
			uid: uidOf(series),
			legendgroup: series,
			x: xs,
			y: xs.map((x) => at.get(x)?.y ?? null),
			customdata: xs.map((x) => at.get(x)?.custom ?? []),
			hovertemplate: o.hovertemplate,
			line: { color, width: 2 },
			marker: { color, size: 8 },
			// Lets end labels sit in the right margin. Plotly still hides points
			// that fall outside a zoomed range.
			cliponaxis: false,
			...(o.labels
				? {
						text: xs.map((x) => (x === last && at.has(x) ? series : "")),
						textposition: "middle right",
						textfont: { color: LABEL_INK, size: 11 },
					}
				: {}),
		};
	});
}

const escapeText = (s: string) =>
	s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function escapeDeep<T>(v: T): T {
	if (typeof v === "string") return escapeText(v) as T;
	if (Array.isArray(v)) return v.map(escapeDeep) as T;
	return v;
}

/**
 * Plotly renders trace names, text, hover fields and category ticks as a
 * subset of HTML (<b>, <a href>, <span style>). Kernel and precision names
 * come from contributed CSVs, so they are escaped to show literally.
 * Templates are the charts' own and keep their markup.
 */
export function escapeLabels(fig: Figure): Figure {
	const { xaxis } = fig.layout;
	return {
		data: fig.data.map(
			(t) =>
				({
					...t,
					name: escapeDeep(t.name),
					text: escapeDeep(t.text),
					customdata: escapeDeep(t.customdata),
					x: escapeDeep(t.x),
				}) as Trace,
		),
		layout: xaxis
			? {
					...fig.layout,
					xaxis: { ...xaxis, categoryarray: escapeDeep(xaxis.categoryarray) },
				}
			: fig.layout,
	};
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/lib/charts/types.test.ts`
Expected: `8 pass, 0 fail`.

Run: `bun test`
Expected: `107 pass, 0 fail`, across 9 files.

- [ ] **Step 6: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/charts/types.ts src/lib/charts/types.test.ts src/lib/fixtures.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 7: Commit**

From the repo root:

```bash
git add web/package.json web/bun.lock web/src/lib/charts/types.ts web/src/lib/charts/types.test.ts web/src/lib/fixtures.ts
git commit -m "Add Plotly and the shared figure builders beside Plot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Render charts with Plotly and port the Overview tab

This task switches the renderer. Afterwards the Overview draws with Plotly, and every other tab still draws with Plot.

**Files:**
- Modify: `web/src/lib/charts/types.ts` (the `ChartSpec` definition)
- Modify: `web/src/lib/charts/blocksize.ts`, `gpu.ts`, `precision.ts`, `threading.ts`: the spec annotations become `PlotChartSpec`
- Modify: `web/src/lib/charts/index.ts` (`Panel.spec`)
- Modify: `web/src/lib/charts/overview.ts`: imports, two annotations, `fastestPerSize`, `throughputByFamily`
- Modify: `web/src/lib/Chart.svelte` (the whole `<script>` block)
- Modify: `web/src/App.svelte` (the panel loop key)
- Modify: `web/vite.config.ts`
- Test: `web/src/lib/charts/overview.test.ts`: three tests

**Interfaces:**
- Consumes (Task 1): `Figure`, `BASE_LAYOUT`, `AXIS`, `LABELLED_MARGIN`, `log2Axis`, `lineTraces`, `SeriesPoint`, `escapeLabels`, and `legendOf` / `pointsOf` from fixtures.
- Produces:
  - `type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => Figure | null`
  - `type PlotChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => PlotSpec | null` (transitional, deleted in Task 8)
  - `Panel.spec: ChartSpec | PlotChartSpec`
  - `Chart.svelte` prop `spec: Figure | PlotSpec | null`
  - `fastestPerSize` and `throughputByFamily` typed `ChartSpec`

- [ ] **Step 1: Update the three Overview tests (failing)**

In `web/src/lib/charts/overview.test.ts`, change the fixtures import to:

```ts
import { legendOf, pointsOf, row } from "../fixtures";
```

Replace the test `"the family chart draws one line per family, in legend order and family ink"` with:

```ts
test("the family chart draws one line per family, in legend order and family ink", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(legendOf(spec)).toEqual({
		names: ["serial", "parallel", "amx", "gpu"],
		colors: ["#844da2", "#008300", "#3987e5", "#e66767"],
	});
});
```

Replace the test `"each family point names the kernel that won it"` with:

```ts
test("each family point names the kernel that won it", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	const gpuAt = (n: number) =>
		pointsOf(spec, "gpu").find((p) => p.x === n)?.custom[0];
	expect(gpuAt(256)).toBe("metal-tiled");
	expect(gpuAt(512)).toBe("mps");
});
```

Replace the test `"fastest-per-size cells are filled by family, so every winner has a colour"` with:

```ts
test("fastest-per-size cells are filled by family, so every winner has a colour", () => {
	const withUnknown: Row[] = [
		...acrossFamilies,
		row({ kernel: "packed-simd", n: 256, gops: 5000 }),
	];
	const spec = fastestPerSize(withUnknown, f, makeCtx(withUnknown));
	// packed-simd (serial) wins 256, accelerate-blas (amx) wins 512.
	expect(legendOf(spec)).toEqual({
		names: ["serial", "amx"],
		colors: ["#844da2", "#3987e5"],
	});
	expect(pointsOf(spec, "serial")).toEqual([
		{ x: "256", y: 1, custom: ["packed-simd", 5000] },
	]);
	// Categorical, in size order: Plotly would read "256" as a number.
	expect(spec?.layout.xaxis?.type).toBe("category");
	expect(spec?.layout.xaxis?.categoryarray).toEqual(["256", "512"]);
	// Stacked bars would otherwise list the legend in reverse.
	expect(spec?.layout.legend?.traceorder).toBe("normal");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/charts/overview.test.ts`

Expected: 3 FAIL. For example, the family test fails with `names` received as `[]`, because a Plot spec has no `data`.

- [ ] **Step 3: Split the spec type**

In `web/src/lib/charts/types.ts`, replace

```ts
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => PlotSpec | null;
```

with

```ts
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => Figure | null;

/** A chart not yet ported to Plotly. Deleted once every chart is. */
export type PlotChartSpec = (
	rows: Row[],
	f: Filters,
	ctx: Ctx,
) => PlotSpec | null;
```

Keep the doc comment above `ChartSpec` as it is.

- [ ] **Step 4: Point the not-yet-ported charts at `PlotChartSpec`**

Run from `web/`:

```bash
for f in blocksize gpu precision threading; do sed -i '' 's/type ChartSpec/type PlotChartSpec/; s/: ChartSpec = /: PlotChartSpec = /' src/lib/charts/$f.ts; done
```

Check with `grep -n "ChartSpec" src/lib/charts/{blocksize,gpu,precision,threading}.ts`.

Expected: every hit reads `PlotChartSpec`: one import per file, plus `blockSizeSweep`, `gpuKernels`, `gpuEqualEffort`, `gpuCopyOverhead`, `throughputByPrecision`, `throughputVsThreads` and `parallelEfficiency`.

In `web/src/lib/charts/index.ts`, replace

```ts
import type { ChartSpec, Ctx, Filters } from "./types";
```

with

```ts
import type { ChartSpec, Ctx, Filters, PlotChartSpec } from "./types";
```

and in `interface Panel` replace `spec: ChartSpec;` with `spec: ChartSpec | PlotChartSpec;`.

- [ ] **Step 5: Port `fastestPerSize` and `throughputByFamily`**

In `web/src/lib/charts/overview.ts`, replace the import block (everything above `type SizePoint = {`) with:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import {
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	type Family,
	familyOf,
	hasKernel,
} from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import {
	AXIS,
	BASE,
	BASE_LAYOUT,
	breakGaps,
	type ChartSpec,
	type Ctx,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
	type PlotChartSpec,
	type PlotSpec,
	type SeriesPoint,
} from "./types";
```

Change `export const throughputVsSize: ChartSpec` to `export const throughputVsSize: PlotChartSpec`, and `export const serialOnly: ChartSpec` to `export const serialOnly: PlotChartSpec`. They move in Task 3.

Replace everything from the doc comment that starts `/**\n * Computed over every kernel, independent of any legend` to the end of the file with the code below. This also removes the `FamilyPoint` and `FamilyGapPoint` types.

```ts
/**
 * Computed over every kernel, independent of any legend: it summarises the
 * data, not the current view. Filled by the winner's family, not its kernel
 * slot: the winner can come from either colour group, and family ink is the
 * set validated on all pairs, since any two families can end up side by side.
 * One bar trace per family, stacked, so each size is a single full-width
 * cell that the legend can still name and hide by family.
 */
export const fastestPerSize: ChartSpec = (rows, _f, ctx) => {
	const winners = new Map<number, Row>();
	for (const r of bestPerKernel(rows)) {
		const n = Number(r.n);
		const current = winners.get(n);
		if (!current || Number(r.gops) > Number(current.gops)) winners.set(n, r);
	}
	if (!winners.size) return null;

	const cells = [...winners.entries()].map(([n, r]) => ({
		n,
		kernel: String(r.kernel),
		family: familyOf(r, ctx.family),
		gops: Number(r.gops),
	}));
	const present = FAMILY_ORDER.filter((family) =>
		cells.some((c) => c.family === family),
	);

	return {
		data: present.map((family) => {
			const mine = cells.filter((c) => c.family === family);
			return {
				type: "bar",
				name: family,
				uid: family,
				x: mine.map((c) => String(c.n)),
				y: mine.map(() => 1),
				customdata: mine.map((c) => [c.kernel, c.gops]),
				texttemplate: "%{customdata[0]}<br>%{customdata[1]:.0f}",
				textposition: "inside",
				insidetextanchor: "middle",
				textfont: { color: "#0e1012", size: 11 },
				marker: { color: FAMILY_INK[family] },
				hovertemplate:
					"<b>%{customdata[1]:.0f} GOP/s</b>  %{customdata[0]} · %{fullData.name}<extra></extra>",
			};
		}),
		layout: {
			...BASE_LAYOUT,
			height: 160,
			// Each cell is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			barmode: "stack",
			bargap: 0.02,
			// Plotly reverses a stacked chart's legend by default; keep the
			// validated family order.
			legend: { ...BASE_LAYOUT.legend, traceorder: "normal" },
			xaxis: {
				...AXIS,
				// Sizes are strings here: without "category" Plotly reads "64" as a
				// number and draws a linear axis.
				type: "category",
				categoryorder: "array",
				categoryarray: [...winners.keys()].sort((a, b) => a - b).map(String),
				showgrid: false,
				fixedrange: true,
				title: { text: "N" },
			},
			yaxis: { ...AXIS, visible: false, range: [0, 1], fixedrange: true },
		},
	};
};

/**
 * One line per family: each family's best kernel, thread count and block size
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const points: SeriesPoint[] = bestPerFamily(rows, ctx.family).map((r) => ({
		series: familyOf(r, ctx.family),
		x: Number(r.n),
		y: Number(r.gops),
		custom: [String(r.kernel), Number(r.threads)],
	}));
	const sizes = log2Ticks(points.map((p) => p.x));
	if (sizes.length < 2) return null;

	const present = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.series === family),
	);

	return {
		data: lineTraces(points, {
			order: present,
			color: (family) => FAMILY_INK[family as Family],
			xs: sizes,
			// At most four series, so direct labels as well as the legend.
			labels: true,
			hovertemplate:
				"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]} · %{customdata[1]}T<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			margin: LABELLED_MARGIN,
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
		},
	};
};
```

- [ ] **Step 6: Run the Overview tests to verify they pass**

Run: `bun test src/lib/charts/overview.test.ts`
Expected: `12 pass, 0 fail`.

- [ ] **Step 7: Replace the renderer**

In `web/src/lib/Chart.svelte`, replace the whole `<script lang="ts"> … </script>` block with the block below. The markup and `<style>` stay unchanged.

```svelte
<script lang="ts">
import * as Plot from "@observablehq/plot";
import type { Config } from "plotly.js-dist-min";
import Plotly from "plotly.js-dist-min";
import { escapeLabels, type Figure, type PlotSpec } from "./charts/types";

let {
	spec,
	title,
	note = "",
	empty = "No data for this selection.",
}: {
	spec: Figure | PlotSpec | null;
	title: string;
	note?: string;
	empty?: string;
} = $props();

let host = $state<HTMLDivElement | null>(null);

/**
 * Plotly's built-ins are why the dashboard uses it: box zoom and pan,
 * double-click to reset, legend click to hide and double-click to isolate,
 * and an SVG download. The selection tools have nothing to act on, and the
 * cloud-upload button, on by default since Plotly 4, would post the chart's
 * data to cloud.plotly.com.
 */
const CONFIG: Partial<Config> = {
	displaylogo: false,
	showSendToCloud: false,
	modeBarButtonsToRemove: ["select2d", "lasso2d"],
};

// ponytail: two renderers while the tabs move to Plotly one at a time; the
// last task of the port deletes the Plot branch. Panels are keyed by title in
// App.svelte, so one div never switches between them.
const isFigure = (s: Figure | PlotSpec): s is Figure =>
	"data" in s && "layout" in s;

$effect(() => {
	if (!host || !spec) return;
	if (!isFigure(spec)) {
		host.replaceChildren(Plot.plot(spec));
		return;
	}
	// A copy: Plotly writes zoom state back into the layout it is handed, and
	// charts share BASE_LAYOUT's nested objects.
	const { data, layout } = escapeLabels(structuredClone(spec));
	Plotly.react(
		host,
		data,
		{
			...layout,
			// A hidden series stays hidden across filter changes (traces are
			// matched by uid); zoom resets, since the axes may hold new data.
			legend: { ...layout.legend, uirevision: title },
		},
		{ ...CONFIG, toImageButtonOptions: { format: "svg", filename: title } },
	);
});

// Its own effect: a cleanup in the draw effect would run before every redraw
// and throw away the zoom and legend state react preserves.
$effect(() => {
	const el = host;
	if (!el) return;
	// Follows the panel, not only the window (which is all Plotly's
	// `responsive` watches): the page scrollbar that appears once the charts
	// load narrows every panel without a window resize. Plots.resize rejects
	// on a div Plotly has not drawn into yet.
	const resize = new ResizeObserver(() => {
		if (el.classList.contains("js-plotly-plot")) Plotly.Plots.resize(el);
	});
	resize.observe(el);
	return () => {
		resize.disconnect();
		Plotly.purge(el);
	};
});
</script>
```

- [ ] **Step 8: Key the panel loop, and raise the chunk warning**

In `web/src/App.svelte`, replace

```svelte
			{#each tab.panels as panel}
```

with

```svelte
			<!-- Keyed: one Chart per panel, so a panel never inherits another
			     tab's chart state. -->
			{#each tab.panels as panel (panel.title)}
```

In `web/vite.config.ts`, replace

```ts
	plugins: [svelte()],
});
```

with

```ts
	plugins: [svelte()],
	build: {
		// Plotly's bundle is ~5 MB minified. The size is accepted (the DuckDB
		// wasm beside it is 34 MB), so don't warn about it on every build.
		chunkSizeWarningLimit: 6000,
	},
});
```

- [ ] **Step 9: Run tests, lint, type gate, build**

Run: `bun test`
Expected: `107 pass, 0 fail`.

Run: `bunx @biomejs/biome check --write src/lib vite.config.ts src/App.svelte`
Expected: no errors. It sorts the renamed imports.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

Run: `bun run build`
Expected: `✓ built`, with no "Some chunks are larger than 500 kB" warning.

- [ ] **Step 10: Browser checks**

Start the preview (`preview_start` with `{ name: "dashboard" }`), navigate to `http://localhost:5173/gemm-bench/`, and wait about 4 s for DuckDB.

1. Run TAB_WALK. Expected:
   - `errs` is `[]`.
   - The Overview panels are `plotly(serial,parallel,amx,gpu)` and `plotly(amx,gpu)` (or whichever families the data has, in serial, parallel, amx, gpu order).
   - Every other tab's panels are `plot`.
2. Click "Overview", then run CHROME. Expected:
   - `buttons` is exactly `["Download plot","Zoom","Pan","Zoom in","Zoom out","Autoscale","Reset axes"]`.
   - `logo` is `false`.
   - Each `widths` pair is equal.
3. Run HOVER. Expected:
   - The first chart returns a size header such as `"1024"`, then one row per family that starts with the value, e.g. `"1875.7 GOP/s  amx · accelerate-blas · 1T"`.
   - The second chart (a bar cell) returns one row such as `"1876 GOP/s  accelerate-blas · amx"`.
4. Take a screenshot. Click the `parallel` legend entry in "Throughput by family", then run:

   ```js
   document.querySelector(".js-plotly-plot")._fullData.map((t) => `${t.name}:${t.visible}`)
   ```

   Expected: `"parallel:legendonly"`.
5. Drag a box inside the same plot (`computer` with `left_click_drag`), then run:

   ```js
   document.querySelector(".js-plotly-plot")._fullLayout.xaxis.autorange
   ```

   Expected: `false`.
6. Click the `f64` precision pill and run both snippets from 4 and 5 again. Expected: `parallel` is still `legendonly`, and `autorange` is `true`.
7. Scroll to "Fastest kernel per size" and take a screenshot. Expected: full-width coloured cells with the kernel and GOP/s in dark text, and the legend in family order (e.g. `amx` before `gpu`).

- [ ] **Step 11: Commit**

From the repo root:

```bash
git add web/src/lib/charts web/src/lib/Chart.svelte web/src/App.svelte web/vite.config.ts
git commit -m "Render charts with Plotly and port the Overview tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Port the CPU & AMX size charts and their stddev band

**Files:**
- Modify: `web/src/lib/charts/overview.ts` (whole file)
- Test: `web/src/lib/charts/overview.test.ts`: five tests replaced, one added

**Interfaces:**
- Consumes: Task 1's builders, plus `uidOf`.
- Produces: `throughputVsSize` and `serialOnly` typed `ChartSpec`. Band traces have `uid: "band-" + uidOf(kernel)`, `showlegend: false`, and `legendgroup` equal to the kernel.

- [ ] **Step 1: Update the tests (failing)**

In `web/src/lib/charts/overview.test.ts`, change the fixtures import to:

```ts
import { legendOf, plotted, pointsOf, row } from "../fixtures";
```

Replace the test `"the legend lists only the kernels plotted, not the whole palette"` with:

```ts
test("the legend lists only the kernels plotted, not the whole palette", () => {
	// serialOnly is fed only naive-ijk rows here, so rayon-ikj (present
	// elsewhere in the palette) must not appear in the legend domain.
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(legendOf(spec).names).toEqual(["naive-ijk"]);
});
```

Replace `"serialOnly drops the parallel kernels"` with:

```ts
test("serialOnly drops the parallel kernels", () => {
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(new Set(plotted(spec).map((p) => p.series))).toEqual(
		new Set(["naive-ijk"]),
	);
});
```

In `"a kernel missing a row at one size gets an explicit gap, not a line straight through it"`, keep the `ragged` fixture. Replace everything from `const spec = throughputVsSize(ragged, f, makeCtx(ragged));` to the end of that test with the following. It also adds a new test right after it:

```ts
	const spec = throughputVsSize(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	const gap = pointsOf(spec, "ikj").find((p) => p.x === 128);
	expect(gap?.y).toBeNull();
	// The band breaks there too: one closed shape per run of sizes, each run
	// followed by the null that separates it from the next.
	const band = spec?.data.find((t) => t.uid === "band-ikj");
	expect(band?.x).toEqual([64, 64, null, 256, 256, null]);
});

test("the relative projection draws no stddev band", () => {
	const spec = throughputVsSize(rows, { ...f, relative: true }, makeCtx(rows));
	expect(spec?.data.some((t) => t.uid?.startsWith("band-"))).toBe(false);
	expect(pointsOf(spec, "rayon-ikj").map((p) => p.y)).toEqual([15, 30]);
});
```

Replace `"the stddev band stays finite when stddev exceeds the median"` with:

```ts
test("the stddev band stays finite when stddev exceeds the median", () => {
	const noisy: Row[] = [
		row({ kernel: "ikj", n: 64, gops: 20, median_ms: 1, stddev_ms: 1.5 }),
		row({ kernel: "ikj", n: 128, gops: 25, median_ms: 1, stddev_ms: 0.01 }),
	];
	const spec = throughputVsSize(noisy, f, makeCtx(noisy));
	const band = spec?.data.find((t) => t.uid === "band-ikj");
	const edges = ((band?.y ?? []) as (number | null)[]).filter(
		(y) => y !== null,
	);
	expect(edges).toHaveLength(4);
	for (const y of edges) {
		expect(Number.isFinite(y)).toBe(true);
		expect(y).toBeLessThan(100);
	}
});
```

Replace `"the CPU & AMX size chart never draws a GPU kernel"` with:

```ts
test("the CPU & AMX size chart never draws a GPU kernel", () => {
	const spec = throughputVsSize(acrossFamilies, f, makeCtx(acrossFamilies));
	const { names } = legendOf(spec);
	expect(names).toEqual(
		expect.arrayContaining(["ikj", "rayon-ikj", "accelerate-blas"]),
	);
	expect(names).not.toContain("mps");
	expect(names).not.toContain("metal-tiled");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/charts/overview.test.ts`

Expected: 6 FAIL. For example, `names` is received as `[]`, and `spec?.data` is undefined on a Plot spec.

- [ ] **Step 3: Replace `overview.ts`**

Replace the whole of `web/src/lib/charts/overview.ts` with:

```ts
import type { ScatterData } from "plotly.js-dist-min";
import type { Row } from "../db";
import {
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	type Family,
	familyOf,
	hasKernel,
} from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	type Ctx,
	type Figure,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
	type SeriesPoint,
	uidOf,
} from "./types";

/** Without a naive-ijk row there is no denominator, so the toggle is hidden. */
export function canShowSpeedup(rows: Row[]): boolean {
	return hasKernel(rows, BASELINE_KERNEL);
}

function baselineAt(rows: Row[]): Map<number, number> {
	const out = new Map<number, number>();
	for (const r of rows) {
		if (r.kernel === BASELINE_KERNEL) out.set(Number(r.n), Number(r.gops));
	}
	return out;
}

type SizePoint = SeriesPoint & { lo: number; hi: number };

/**
 * One kernel's ±1 stddev band. fill "toself" closes each null-separated run
 * of consecutive sizes on its own, so the band breaks at a missing size
 * exactly where the line does. It shares the line's legend group, so hiding
 * the kernel hides both.
 */
function band(
	kernel: string,
	color: string,
	sizes: number[],
	points: SizePoint[],
): Partial<ScatterData> {
	const at = new Map(
		points.filter((p) => p.series === kernel).map((p) => [p.x, p]),
	);
	const x: (number | null)[] = [];
	const y: (number | null)[] = [];
	let run: SizePoint[] = [];
	const close = () => {
		if (run.length) {
			const back = [...run].reverse();
			x.push(...run.map((p) => p.x), ...back.map((p) => p.x), null);
			y.push(...run.map((p) => p.hi), ...back.map((p) => p.lo), null);
		}
		run = [];
	};
	for (const n of sizes) {
		const p = at.get(n);
		if (p) run.push(p);
		else close();
	}
	close();
	return {
		type: "scatter",
		mode: "none",
		uid: `band-${uidOf(kernel)}`,
		legendgroup: kernel,
		showlegend: false,
		hoverinfo: "skip",
		x,
		y,
		fill: "toself",
		// 26 hex is 15% alpha, the old band's fillOpacity.
		fillcolor: `${color}26`,
	};
}

function sizeSeries(rows: Row[], ctx: Ctx, relative: boolean): Figure | null {
	const best = bestPerKernel(rows).filter((r) =>
		ctx.palette.has(String(r.kernel)),
	);
	const sizes = log2Ticks(best.map((r) => Number(r.n)));
	if (sizes.length < 2) return null;

	const base = baselineAt(best);
	const points: SizePoint[] = best
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.n),
			custom: [Number(r.threads)],
			// gops is 2N^3/median_ms, so the band is that value at median±stddev.
			lo:
				Number(r.gops) *
				(Number(r.median_ms) / (Number(r.median_ms) + Number(r.stddev_ms))),
			// Floored at half the median, not near-zero: measured stddev exceeds
			// the median at the smallest sizes, so median-stddev goes negative
			// there. A near-zero floor would blow the upper edge up ~1e9x and
			// destroy the log axis; this is a legibility band, not a confidence
			// interval, so understating spread at the noisiest sizes is fine.
			hi:
				Number(r.gops) *
				(Number(r.median_ms) /
					Math.max(
						Number(r.median_ms) - Number(r.stddev_ms),
						Number(r.median_ms) * 0.5,
					)),
			y: relative
				? Number(r.gops) / (base.get(Number(r.n)) ?? Number.NaN)
				: Number(r.gops),
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw. ctx.palette is still
	// the hue lookup, so a kernel keeps its colour regardless of who else is
	// present.
	const present = [...new Set(points.map((p) => p.series))];
	const color = (kernel: string) => ctx.palette.get(kernel) as string;
	// Direct labels in addition to the legend, but only when there are few
	// enough series to read them — the headline chart can carry up to 8.
	const showLabels = present.length <= 4;
	const unit = relative ? "×" : " GOP/s";

	const lines = lineTraces(points, {
		order: present,
		color,
		xs: sizes,
		labels: showLabels,
		hovertemplate: `<b>%{y:.1f}${unit}</b>  %{fullData.name} · %{customdata[0]}T<extra></extra>`,
	});
	return {
		// Bands first, so every line draws over every band.
		data: relative
			? lines
			: [...present.map((k) => band(k, color(k), sizes, points)), ...lines],
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: {
				...AXIS,
				type: "log",
				title: { text: relative ? "× vs naive-ijk" : "GOP/s" },
			},
		},
	};
}

/**
 * Per-kernel view of the host group only. GPU kernels are compared on the
 * GPU tab and folded into the Overview's family lines: a chart never draws
 * kernels from both colour groups.
 */
export const throughputVsSize: ChartSpec = (rows, f, ctx) => {
	const host = rows.filter((r) => familyOf(r, ctx.family) !== "gpu");
	return sizeSeries(host, ctx, f.relative && canShowSpeedup(host));
};

export const serialOnly: ChartSpec = (rows, _f, ctx) =>
	sizeSeries(
		rows.filter((r) => ctx.family.get(String(r.kernel)) === "serial"),
		ctx,
		false,
	);

/**
 * Computed over every kernel, independent of any legend: it summarises the
 * data, not the current view. Filled by the winner's family, not its kernel
 * slot: the winner can come from either colour group, and family ink is the
 * set validated on all pairs, since any two families can end up side by side.
 * One bar trace per family, stacked, so each size is a single full-width
 * cell that the legend can still name and hide by family.
 */
export const fastestPerSize: ChartSpec = (rows, _f, ctx) => {
	const winners = new Map<number, Row>();
	for (const r of bestPerKernel(rows)) {
		const n = Number(r.n);
		const current = winners.get(n);
		if (!current || Number(r.gops) > Number(current.gops)) winners.set(n, r);
	}
	if (!winners.size) return null;

	const cells = [...winners.entries()].map(([n, r]) => ({
		n,
		kernel: String(r.kernel),
		family: familyOf(r, ctx.family),
		gops: Number(r.gops),
	}));
	const present = FAMILY_ORDER.filter((family) =>
		cells.some((c) => c.family === family),
	);

	return {
		data: present.map((family) => {
			const mine = cells.filter((c) => c.family === family);
			return {
				type: "bar",
				name: family,
				uid: family,
				x: mine.map((c) => String(c.n)),
				y: mine.map(() => 1),
				customdata: mine.map((c) => [c.kernel, c.gops]),
				texttemplate: "%{customdata[0]}<br>%{customdata[1]:.0f}",
				textposition: "inside",
				insidetextanchor: "middle",
				textfont: { color: "#0e1012", size: 11 },
				marker: { color: FAMILY_INK[family] },
				hovertemplate:
					"<b>%{customdata[1]:.0f} GOP/s</b>  %{customdata[0]} · %{fullData.name}<extra></extra>",
			};
		}),
		layout: {
			...BASE_LAYOUT,
			height: 160,
			// Each cell is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			barmode: "stack",
			bargap: 0.02,
			// Plotly reverses a stacked chart's legend by default; keep the
			// validated family order.
			legend: { ...BASE_LAYOUT.legend, traceorder: "normal" },
			xaxis: {
				...AXIS,
				// Sizes are strings here: without "category" Plotly reads "64" as a
				// number and draws a linear axis.
				type: "category",
				categoryorder: "array",
				categoryarray: [...winners.keys()].sort((a, b) => a - b).map(String),
				showgrid: false,
				fixedrange: true,
				title: { text: "N" },
			},
			yaxis: { ...AXIS, visible: false, range: [0, 1], fixedrange: true },
		},
	};
};

/**
 * One line per family: each family's best kernel, thread count and block size
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const points: SeriesPoint[] = bestPerFamily(rows, ctx.family).map((r) => ({
		series: familyOf(r, ctx.family),
		x: Number(r.n),
		y: Number(r.gops),
		custom: [String(r.kernel), Number(r.threads)],
	}));
	const sizes = log2Ticks(points.map((p) => p.x));
	if (sizes.length < 2) return null;

	const present = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.series === family),
	);

	return {
		data: lineTraces(points, {
			order: present,
			color: (family) => FAMILY_INK[family as Family],
			xs: sizes,
			// At most four series, so direct labels as well as the legend.
			labels: true,
			hovertemplate:
				"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]} · %{customdata[1]}T<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			margin: LABELLED_MARGIN,
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
		},
	};
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/charts/overview.test.ts`
Expected: `13 pass, 0 fail`.

Run: `bun test`
Expected: `108 pass, 0 fail`.

- [ ] **Step 5: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/charts/overview.ts src/lib/charts/overview.test.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 6: Browser checks**

1. Reload the preview, then run TAB_WALK. Expected:
   - `errs` is `[]`.
   - Both CPU & AMX panels are `plotly(...)`, listing kernels in palette order with no GPU kernel.
2. Click "CPU & AMX" and take a screenshot. Expected: a faint band under each line, and the legend wraps to two rows.
3. Click `naive-ijk` in the legend, then run:

   ```js
   document.querySelector(".js-plotly-plot")._fullData.filter((t) => t.legendgroup === "naive-ijk").map((t) => `${t.uid}:${t.visible}`)
   ```

   Expected: both `band-naive-ijk` and `naive-ijk` are `legendonly`.
4. Tick "Relative", then run:

   ```js
   document.querySelector(".js-plotly-plot")._fullLayout.yaxis.title.text
   ```

   Expected: `"× vs naive-ijk"`.

- [ ] **Step 7: Commit**

From the repo root:

```bash
git add web/src/lib/charts/overview.ts web/src/lib/charts/overview.test.ts
git commit -m "Port the CPU & AMX size charts and their stddev band to Plotly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Port the threading charts and order the efficiency ramp by size

**Files:**
- Modify: `web/src/lib/palette.ts` (append)
- Modify: `web/src/lib/charts/threading.ts` (whole file)
- Test: `web/src/lib/palette.test.ts`, `web/src/lib/charts/threading.test.ts`

**Interfaces:**
- Consumes: `AXIS`, `BASE_LAYOUT`, `LABELLED_MARGIN`, `lineTraces` and `SeriesPoint` (Task 1); `legendOf` and `plotted` (fixtures).
- Produces:
  - `sequentialRamp(n: number): string[]` in `palette.ts`
  - `throughputVsThreads` and `parallelEfficiency` typed `ChartSpec`
  - `layout.shapes`: the ideal line in relative mode, otherwise `[]`

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/palette.test.ts`, add `sequentialRamp,` to the import from `"./palette"` (after `paletteFor,`), then append:

```ts
test("the size ramp runs light to dark along YlGnBu, one colour per size", () => {
	expect(sequentialRamp(7)).toEqual([
		"#ffffd9",
		"#edf8b1",
		"#c7e9b4",
		"#7fcdbb",
		"#41b6c4",
		"#1d91c0",
		"#225ea8",
	]);
	expect(sequentialRamp(2)).toEqual(["#ffffd9", "#225ea8"]);
	expect(sequentialRamp(1)).toEqual(["#7fcdbb"]);
});
```

In `web/src/lib/charts/threading.test.ts`, change the fixtures import to:

```ts
import { legendOf, plotted, row } from "../fixtures";
```

Replace `"efficiency builds per size and caps the axis at 100"` with:

```ts
test("efficiency builds per size and caps the axis at 100", () => {
	const spec = parallelEfficiency(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	expect(spec?.layout.yaxis?.range).toEqual([0, 100]);
});
```

Replace `"the legend lists only the kernels plotted, not the whole palette"` with:

```ts
test("the legend lists only the kernels plotted, not the whole palette", () => {
	// ikj is serial (filtered out by parallelRows), so it must not appear in
	// the color domain even though it's in the fixture and the palette.
	const { names } = legendOf(throughputVsThreads(rows, f, makeCtx(rows)));
	expect(names).toEqual(expect.arrayContaining(["rayon-ikj", "static-ikj"]));
	expect(names).toHaveLength(2);
});
```

Replace `"parallelEfficiency plots only the selected kernel, one line per size"` with this test and two new ones:

```ts
test("parallelEfficiency plots only the selected kernel, one line per size", () => {
	const spec = parallelEfficiency(rows, f, makeCtx(rows));
	expect(legendOf(spec).names).toEqual(["1024"]);
	const rayonRows = rows.filter((r) => r.kernel === "rayon-ikj");
	expect(plotted(spec)).toHaveLength(rayonRows.length);
});

test("efficiency colours sizes in numeric order, light to dark", () => {
	const twoSizes: Row[] = [
		...rows,
		row({ kernel: "rayon-ikj", precision: "f16", n: 128, gops: 9 }),
		row({
			kernel: "rayon-ikj",
			precision: "f16",
			n: 128,
			threads: 4,
			gops: 30,
		}),
	];
	const spec = parallelEfficiency(twoSizes, f, makeCtx(twoSizes));
	expect(legendOf(spec)).toEqual({
		names: ["128", "1024"],
		colors: ["#ffffd9", "#225ea8"],
	});
});

test("the relative scaling chart draws the ideal line as a dashed reference", () => {
	const spec = throughputVsThreads(
		rows,
		{ ...f, relative: true },
		makeCtx(rows),
	);
	expect(spec?.layout.shapes).toEqual([
		expect.objectContaining({ x0: 1, y0: 1, x1: 10, y1: 10 }),
	]);
	expect(throughputVsThreads(rows, f, makeCtx(rows))?.layout.shapes).toEqual(
		[],
	);
});
```

In `"the scaling chart plots only the selected size"`, keep the `twoSizes` fixture. Replace everything from `const spec = throughputVsThreads(twoSizes, f, makeCtx(twoSizes));` to the end of the test with:

```ts
	const spec = throughputVsThreads(twoSizes, f, makeCtx(twoSizes));
	// f pins n = 1024, so the three n = 256 rows must not appear.
	expect(plotted(spec)).toHaveLength(
		rows.filter((r) => r.kernel !== "ikj").length,
	);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/palette.test.ts src/lib/charts/threading.test.ts`

Expected: FAIL. `palette.test.ts` fails with `Export named 'sequentialRamp' not found`, and the threading tests find no `layout` or `data` on a Plot spec.

- [ ] **Step 3: Add the ramp**

Append to `web/src/lib/palette.ts`:

```ts
/**
 * ColorBrewer YlGnBu, d3.schemeYlGnBu[9]. The efficiency chart colours matrix
 * sizes along it: N is ordinal, not a kernel identity, so a sequential ramp
 * and not the categorical slots.
 */
const YLGNBU = [
	"#ffffd9",
	"#edf8b1",
	"#c7e9b4",
	"#7fcdbb",
	"#41b6c4",
	"#1d91c0",
	"#225ea8",
	"#253494",
	"#081d58",
] as const;

/**
 * The legible part of YlGnBu on the dark surface (#15181b): the two darkest
 * stops, #253494 and #081d58, all but vanish against it.
 */
const RAMP = YLGNBU.slice(0, 7);

/** n colours spread evenly along RAMP, light (smallest N) to dark. */
export function sequentialRamp(n: number): string[] {
	if (n <= 1) return [RAMP[3]];
	// ponytail: past seven sizes neighbours repeat a stop; interpolate in OKLab
	// if the sweep ever grows that far.
	return Array.from(
		{ length: n },
		(_, i) => RAMP[Math.round((i * (RAMP.length - 1)) / (n - 1))],
	);
}
```

- [ ] **Step 4: Replace `threading.ts`**

Replace the whole of `web/src/lib/charts/threading.ts` with:

```ts
import type { Row } from "../db";
import { hasSingleThreadBaseline } from "../derive";
import { REFERENCE_INK, sequentialRamp } from "../palette";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	type Ctx,
	LABELLED_MARGIN,
	lineTraces,
	type SeriesPoint,
} from "./types";

/** Speedup is relative to one thread, so a 1-thread row must exist. */
export function canShowScaling(rows: Row[]): boolean {
	return hasSingleThreadBaseline(rows);
}

function parallelRows(rows: Row[], ctx: Ctx): Row[] {
	return rows.filter(
		(r) =>
			ctx.family.get(String(r.kernel)) === "parallel" &&
			ctx.palette.has(String(r.kernel)),
	);
}

function singleThread(rows: Row[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const r of rows) {
		if (Number(r.threads) === 1) out.set(String(r.kernel), Number(r.gops));
	}
	return out;
}

export const throughputVsThreads: ChartSpec = (rows, f, ctx) => {
	// The threading tab pins a size: without this, several sizes' rows land on
	// the same x position and the 1-thread baseline below picks an arbitrary one.
	const mine = parallelRows(rows, ctx).filter((r) => Number(r.n) === f.n);
	const counts = new Set(mine.map((r) => Number(r.threads)));
	if (counts.size < 2) return null;

	const relative = f.relative && canShowScaling(mine);
	const base = singleThread(mine);
	const points: SeriesPoint[] = mine
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.threads),
			y: relative
				? Number(r.gops) / (base.get(String(r.kernel)) ?? Number.NaN)
				: Number(r.gops),
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...counts].sort((a, b) => a - b);
	const last = ticks[ticks.length - 1];

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw. ctx.palette is
	// still the hue lookup, so a kernel keeps its colour regardless of who
	// else is present.
	const present = [...new Set(points.map((p) => p.series))];

	return {
		// No shared xs: a kernel swept over fewer thread counts is a shorter
		// sweep, not a missing measurement, so its line is not broken.
		data: lineTraces(points, {
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			labels: true,
			hovertemplate: `<b>%{y:.1f}${relative ? "×" : " GOP/s"}</b>  %{fullData.name}<extra></extra>`,
		}),
		layout: {
			...BASE_LAYOUT,
			// Direct labels need room for the longest kernel name.
			margin: LABELLED_MARGIN,
			// Linear, not log: 8 and 10 really are close, and linear shows the
			// departure from ideal as curvature where log would straighten it.
			xaxis: {
				...AXIS,
				type: "linear",
				tickvals: ticks,
				title: { text: "Threads" },
			},
			yaxis: {
				...AXIS,
				type: "linear",
				title: { text: relative ? "× vs 1 thread" : "GOP/s" },
			},
			// Ideal linear speedup, y = threads: a shape, so no legend entry or hover.
			shapes: relative
				? [
						{
							type: "line",
							x0: ticks[0],
							y0: ticks[0],
							x1: last,
							y1: last,
							line: { color: REFERENCE_INK, dash: "dash", width: 1.5 },
						},
					]
				: [],
		},
	};
};

export const parallelEfficiency: ChartSpec = (rows, f, ctx) => {
	// Scoped to the pinned kernel: without this, each size's line would
	// interleave every parallel kernel's points and jump between thread counts
	// across kernels instead of running monotonically within one.
	const mine = parallelRows(rows, ctx).filter((r) => r.kernel === f.kernel);
	if (!mine.length) return null;
	if (!canShowScaling(mine)) return null;

	// Baseline per (kernel, n) so efficiency compares like with like.
	const base = new Map<string, number>();
	for (const r of mine) {
		if (Number(r.threads) === 1)
			base.set(`${r.kernel}\u0000${r.n}`, Number(r.gops));
	}

	const points: SeriesPoint[] = mine
		.map((r) => ({
			series: String(r.n),
			x: Number(r.threads),
			y:
				(Number(r.gops) /
					(base.get(`${r.kernel}\u0000${r.n}`) ?? Number.NaN) /
					Number(r.threads)) *
				100,
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
	if (ticks.length < 2) return null;

	// Extend rather than clamp: a real result above 100% (cache-locality
	// effects on small problems) must still be visible, not silently capped.
	const ceiling = Math.max(100, ...points.map((p) => p.y));

	// Numeric order, so the ramp runs light (small N) to dark: sorted as
	// strings, "1024" would come before "128".
	const sizes = [...new Set(points.map((p) => p.series))].sort(
		(a, b) => Number(a) - Number(b),
	);
	const ramp = sequentialRamp(sizes.length);

	return {
		data: lineTraces(points, {
			order: sizes,
			color: (n) => ramp[sizes.indexOf(n)],
			hovertemplate: "<b>%{y:.0f}%</b>  N = %{fullData.name}<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			legend: { ...BASE_LAYOUT.legend, title: { text: "N" } },
			xaxis: {
				...AXIS,
				type: "linear",
				tickvals: ticks,
				title: { text: "Threads" },
			},
			yaxis: {
				...AXIS,
				type: "linear",
				range: [0, ceiling],
				title: { text: "% of ideal" },
			},
		},
	};
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/lib/palette.test.ts src/lib/charts/threading.test.ts`
Expected: all pass (11 threading tests).

Run: `bun test`
Expected: `111 pass, 0 fail`.

- [ ] **Step 6: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/palette.ts src/lib/palette.test.ts src/lib/charts/threading.ts src/lib/charts/threading.test.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 7: Browser checks**

1. Reload the preview, then run TAB_WALK. Expected:
   - `errs` is `[]`.
   - The CPU threading panels are `plotly(rayon-ikj,rayon-tiled,static-ikj,static-tiled)` and `plotly(64,128,…,4096)`, with the sizes in numeric order.
2. Click "CPU threading", scroll to "Parallel efficiency" and take a screenshot. Expected: the lines go from pale yellow (N=64) to blue (N=4096), every line is visible on the dark panel, and the legend is titled "N".
3. Tick "Relative", then run:

   ```js
   document.querySelector(".js-plotly-plot")._fullLayout.shapes.length
   ```

   Expected: `1`, the dashed ideal line.

- [ ] **Step 8: Commit**

From the repo root:

```bash
git add web/src/lib/palette.ts web/src/lib/palette.test.ts web/src/lib/charts/threading.ts web/src/lib/charts/threading.test.ts
git commit -m "Port the threading charts to Plotly and order the efficiency ramp by size" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Port the precision bars

**Files:**
- Modify: `web/src/lib/charts/precision.ts` (whole file)
- Test: `web/src/lib/charts/precision.test.ts`: four tests

**Interfaces:**
- Consumes: `AXIS` and `BASE_LAYOUT` (Task 1); `legendOf`, `plotted` and `pointsOf` (fixtures).
- Produces: `throughputByPrecision` typed `ChartSpec`. It has one bar trace per family, with `x` holding precision names in `layout.xaxis.categoryarray` order.

- [ ] **Step 1: Update the tests (failing)**

In `web/src/lib/charts/precision.test.ts`, change the fixtures import to:

```ts
import { legendOf, plotted, pointsOf, row } from "../fixtures";
```

Replace `"precisions are ordered by descending best throughput"` with:

```ts
test("precisions are ordered by descending best throughput", () => {
	const spec = throughputByPrecision(rows, f, makeCtx(rows));
	expect(spec?.layout.xaxis?.categoryarray).toEqual(["f32", "i64"]);
});
```

Replace `"one bar per family, in legend order and family ink"` with:

```ts
test("one bar per family, in legend order and family ink", () => {
	const spec = throughputByPrecision(rows, f, makeCtx(rows));
	expect(legendOf(spec)).toEqual({
		names: ["serial", "parallel"],
		colors: ["#844da2", "#008300"],
	});
});
```

In `"a row at a different size does not leak into the pinned size"`, keep the `multiSize` fixture. Replace everything from `const spec = throughputByPrecision(multiSize, f, makeCtx(multiSize));` to the end of the test with:

```ts
	const spec = throughputByPrecision(multiSize, f, makeCtx(multiSize));
	const serialAtI64 = pointsOf(spec, "serial").find((b) => b.x === "i64");
	expect(serialAtI64?.y).toBe(6);
});
```

In `"the i32 group has a GPU bar and no AMX bar"`, keep the `mixed` fixture. Replace everything from `const spec = throughputByPrecision(mixed, f, makeCtx(mixed));` to the end of the test with:

```ts
	const spec = throughputByPrecision(mixed, f, makeCtx(mixed));
	const at = (p: string) =>
		plotted(spec)
			.filter((b) => b.x === p)
			.map((b) => b.series)
			.sort();
	expect(at("i32")).toEqual(["gpu", "parallel"]);
	expect(at("f32")).toEqual(["amx", "parallel"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/charts/precision.test.ts`
Expected: 4 FAIL.

- [ ] **Step 3: Replace `precision.ts`**

Replace the whole of `web/src/lib/charts/precision.ts` with:

```ts
import { bestPerFamily, familyOf } from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import { AXIS, BASE_LAYOUT, type ChartSpec } from "./types";

type Bar = { precision: string; family: string; kernel: string; gops: number };

/**
 * Grouped bars, one group per precision and one bar per family: each family's
 * best kernel at the selected size. Families, not kernels, because this chart
 * crosses the host and GPU colour groups. The precision pill group is inert
 * on this tab: precision is the x-axis here, so filtering by it would leave
 * one group. `f.n` still pins the size.
 */
export const throughputByPrecision: ChartSpec = (rows, f, ctx) => {
	const bars: Bar[] = bestPerFamily(
		rows.filter((r) => Number(r.n) === f.n),
		ctx.family,
	).map((r) => ({
		precision: String(r.precision),
		family: familyOf(r, ctx.family),
		kernel: String(r.kernel),
		gops: Number(r.gops),
	}));
	const order = [...new Set(bars.map((b) => b.precision))].sort(
		(a, b) =>
			Math.max(...bars.filter((x) => x.precision === b).map((x) => x.gops)) -
			Math.max(...bars.filter((x) => x.precision === a).map((x) => x.gops)),
	);
	if (order.length < 2) return null;

	// Scoped to the families actually plotted, in the validated legend order.
	// One trace per family, so within every group the bars sit in that order
	// and adjacent bars are the validated adjacent pairs. A family missing at
	// a precision leaves its slot empty rather than shifting its neighbours.
	const present = FAMILY_ORDER.filter((family) =>
		bars.some((b) => b.family === family),
	);

	return {
		data: present.map((family) => {
			const mine = bars.filter((b) => b.family === family);
			return {
				type: "bar",
				name: family,
				uid: family,
				x: mine.map((b) => b.precision),
				y: mine.map((b) => b.gops),
				customdata: mine.map((b) => [b.kernel]),
				marker: { color: FAMILY_INK[family] },
				hovertemplate:
					"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]}<extra></extra>",
			};
		}),
		layout: {
			...BASE_LAYOUT,
			// Each bar is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			barmode: "group",
			// A thin surface gap between adjacent bars in a group.
			bargroupgap: 0.05,
			xaxis: {
				...AXIS,
				type: "category",
				categoryorder: "array",
				categoryarray: order,
				title: { text: "Precision" },
			},
			yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
		},
	};
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/charts/precision.test.ts`
Expected: `6 pass, 0 fail`.

Run: `bun test`
Expected: `111 pass, 0 fail`.

- [ ] **Step 5: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/charts/precision.ts src/lib/charts/precision.test.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 6: Browser checks**

1. Reload the preview, then run TAB_WALK. Expected: `errs` is `[]`, and the Precision panel is `plotly(serial,parallel,amx,gpu)`.
2. Click "Precision" and take a screenshot. Expected:
   - bars are grouped by precision, best group first;
   - within each group the family order is serial, parallel, amx, gpu;
   - a family that didn't run at a precision leaves a gap.
3. Run HOVER with `fy = 0.9`, which is near the plot's bottom and so inside a bar. Expected: one row such as `"3558.2 GOP/s  gpu · mps"`. This is per-bar hover, not a list of every series.

- [ ] **Step 7: Commit**

From the repo root:

```bash
git add web/src/lib/charts/precision.ts web/src/lib/charts/precision.test.ts
git commit -m "Port the precision bars to Plotly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Port the GPU tab

**Files:**
- Modify: `web/src/lib/charts/gpu.ts` (whole file)
- Test: `web/src/lib/charts/gpu.test.ts` (the helper removed; eight tests replaced, two added) and `web/src/lib/charts/index.test.ts` (one test)

**Interfaces:**
- Consumes: `AXIS`, `BASE_LAYOUT`, `LABEL_INK`, `LABELLED_MARGIN`, `lineTraces`, `log2Axis`, `log2Ticks` and `SeriesPoint` (Task 1); `legendOf`, `plotted` and `pointsOf` (fixtures).
- Produces: `gpuKernels`, `gpuEqualEffort` and `gpuCopyOverhead` typed `ChartSpec`. `gpuEqualEffort` adds a text-only trace with `uid: "labels"` and one paper-wide shape at y = 1. `COUNTERPART` is unchanged.

- [ ] **Step 1: Update the tests (failing)**

In `web/src/lib/charts/gpu.test.ts`, change the fixtures import to:

```ts
import { legendOf, plotted, pointsOf, row } from "../fixtures";
```

Delete the `type Dot = { … };` declaration and the `const marksData = …;` helper below it.

Replace `"the kernel chart draws each GPU kernel then both CPU references, in validated order"` with that test plus a new one:

```ts
test("the kernel chart draws each GPU kernel then both CPU references, in validated order", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	expect(legendOf(spec)).toEqual({
		names: ["metal-naive", "metal-tiled", "mps", "AMX", "parallel CPU"],
		colors: ["#d95926", "#9085e9", "#e66767", "#3987e5", "#008300"],
	});
});

test("a reference point names the CPU kernel and thread count behind it", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	const at512 = (series: string) =>
		pointsOf(spec, series).find((p) => p.x === 512)?.custom[0];
	expect(at512("parallel CPU")).toBe(" · rayon-ikj · 8T");
	expect(at512("mps")).toBe("");
});
```

In `"at an integer precision there is no AMX or mps, leaving three labelled series"`, keep the `i32` fixture. Replace everything from `const spec = gpuKernels(i32, { ...f, precision: "i32" }, makeCtx(i32));` to the end of the test with:

```ts
	const spec = gpuKernels(i32, { ...f, precision: "i32" }, makeCtx(i32));
	expect(legendOf(spec).names).toEqual([
		"metal-naive",
		"metal-tiled",
		"parallel CPU",
	]);
	expect(
		spec?.data.every((t) => "mode" in t && t.mode === "lines+markers+text"),
	).toBe(true);
});
```

In `"a GPU kernel missing a size gets an explicit gap, not a line straight through it"`, replace the two lines after the `ragged` fixture with:

```ts
	const spec = gpuKernels(ragged, f, makeCtx(ragged));
	expect(pointsOf(spec, "mps").find((p) => p.x === 2048)?.y).toBeNull();
```

Replace `"mps is divided by AMX and the shaders by the parallel CPU"` with that test plus a new one:

```ts
test("mps is divided by AMX and the shaders by the parallel CPU", () => {
	const spec = gpuEqualEffort(f32, f, makeCtx(f32));
	const at = (kernel: string, n: number) =>
		pointsOf(spec, kernel).find((p) => p.x === n);
	expect(at("mps", 1024)?.custom[0]).toBe("accelerate-blas");
	expect(at("mps", 1024)?.y).toBeCloseTo(1675 / 1748);
	expect(at("metal-tiled", 512)?.custom[0]).toBe("rayon-ikj");
	expect(at("metal-tiled", 512)?.y).toBeCloseTo(268 / 174);
});

test("the ratio chart draws 1.0 as a dashed reference across the whole plot", () => {
	const spec = gpuEqualEffort(f32, f, makeCtx(f32));
	expect(spec?.layout.shapes).toEqual([
		expect.objectContaining({ xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1 }),
	]);
});
```

In `"a size the counterpart never ran contributes no point, never NaN"`, replace the three lines after the `noAmxAt512` fixture with:

```ts
	const spec = gpuEqualEffort(noAmxAt512, f, makeCtx(noAmxAt512));
	expect(pointsOf(spec, "mps").find((p) => p.x === 512)?.y).toBeNull();
	expect(plotted(spec).every((p) => Number.isFinite(p.y))).toBe(true);
```

In `"end labels that would overlap on the log axis share one line of text"`, keep the `converging` fixture. Replace everything from `const labels = marksData(` to the end of the test with:

```ts
	const spec = gpuEqualEffort(converging, f, makeCtx(converging));
	const labels = spec?.data.find((t) => t.uid === "labels");
	expect(labels?.text).toEqual(["mps · metal-naive", "metal-tiled"]);
	expect(labels?.showlegend).toBe(false);
});
```

Replace `"copy overhead is the share of end-to-end time outside the GPU dispatch"` with:

```ts
test("copy overhead is the share of end-to-end time outside the GPU dispatch", () => {
	const spec = gpuCopyOverhead(f32, f, makeCtx(f32));
	expect(pointsOf(spec, "mps").find((p) => p.x === 512)?.y).toBeCloseTo(
		((0.384 - 0.304) / 0.384) * 100,
	);
});
```

In `"a GPU row without a GPU-only twin is left out of the overhead chart"`, replace the three lines after the `noTwin` fixture with:

```ts
	const { names } = legendOf(gpuCopyOverhead(noTwin, f, makeCtx(noTwin)));
	expect(names).not.toContain("mps");
	expect(names).toContain("metal-tiled");
```

In `web/src/lib/charts/index.test.ts`, change the fixtures import to:

```ts
import { pointsOf, row } from "../fixtures";
```

In the test that builds `gpuKernels(scoped, { ...f, blockSize: 32 }, ctx)`, replace

```ts
	const line = spec?.marks?.[0] as
		| { data: { series: string; n: number; gops: number | null }[] }
		| undefined;
	expect(
		line?.data.find((d) => d.series === "parallel CPU" && d.n === 256)?.gops,
	).toBe(60);
```

with

```ts
	expect(pointsOf(spec, "parallel CPU").find((p) => p.x === 256)?.y).toBe(60);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/charts/gpu.test.ts src/lib/charts/index.test.ts`

Expected: FAIL in every changed GPU test and in the index test. `"no GPU chart builds without metal rows"` still passes.

- [ ] **Step 3: Replace `gpu.ts`**

Replace the whole of `web/src/lib/charts/gpu.ts` with:

```ts
import type { Row } from "../db";
import { bestPerFamily, bestPerKernel, type Family, familyOf } from "../derive";
import { FAMILY_INK, REFERENCE_INK } from "../palette";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	type Ctx,
	LABEL_INK,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
	type SeriesPoint,
} from "./types";

/**
 * The CPU family each GPU kernel is measured against at equal engineering
 * effort: vendor library against vendor library (mps against Accelerate on
 * AMX), hand-written against hand-written (the shaders against the parallel
 * CPU kernels). Nothing in the data marks mps as a vendor library, since all
 * three GPU kernels are backend "metal", so like BASELINE_KERNEL this is keyed
 * by name. A Map, not an object literal: kernel names come from contributed
 * CSVs, and "constructor" must not resolve to a prototype member.
 */
export const COUNTERPART = new Map<string, Family>([["mps", "amx"]]);
const counterpartOf = (kernel: string): Family =>
	COUNTERPART.get(kernel) ?? "parallel";

/** The CPU-side reference lines drawn beside the GPU kernels, in legend order. */
const REFERENCES: { family: Family; label: string }[] = [
	{ family: "amx", label: "AMX" },
	{ family: "parallel", label: "parallel CPU" },
];

type Point = {
	n: number;
	series: string;
	kernel: string;
	threads: number;
	gops: number;
};

const toPoint = (series: string, r: Row): Point => ({
	n: Number(r.n),
	series,
	kernel: String(r.kernel),
	threads: Number(r.threads),
	gops: Number(r.gops),
});

/** Each GPU kernel's best row at each size; rows are end-to-end (withEndToEnd). */
function gpuPoints(rows: Row[], ctx: Ctx): Point[] {
	return bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" && ctx.palette.has(String(r.kernel)),
		)
		.map((r) => toPoint(String(r.kernel), r));
}

/** A family's best row at each size, keyed by n. */
function familyBest(rows: Row[], ctx: Ctx, family: Family): Map<number, Row> {
	return new Map(
		bestPerFamily(rows, ctx.family)
			.filter((r) => familyOf(r, ctx.family) === family)
			.map((r): [number, Row] => [Number(r.n), r]),
	);
}

/**
 * Each GPU kernel against the best parallel-CPU and AMX result at every size.
 * GPU rows carry end-to-end timings, the same host-to-host scope as the CPU
 * rows, so every line is solid.
 */
export const gpuKernels: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	if (!kernelPoints.length) return null;
	const referencePoints = REFERENCES.flatMap(({ family, label }) =>
		[...familyBest(rows, ctx, family).values()].map((r) => toPoint(label, r)),
	);
	const points = [...kernelPoints, ...referencePoints];
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// The validated legend order: GPU kernels (metal-naive, metal-tiled, mps
	// sort that way), then the references.
	const kernels = [...new Set(kernelPoints.map((p) => p.series))].sort();
	const references = REFERENCES.filter(({ label }) =>
		referencePoints.some((p) => p.series === label),
	);
	const ink = new Map([
		...kernels.map((k) => [k, ctx.palette.get(k) as string] as const),
		...references.map((r) => [r.label, FAMILY_INK[r.family]] as const),
	]);
	const order = [...ink.keys()];
	const showLabels = order.length <= 4;

	return {
		data: lineTraces(
			points.map((p) => ({
				series: p.series,
				x: p.n,
				y: p.gops,
				// A reference line names the kernel and thread count behind each
				// point; a GPU kernel's own line already is that kernel.
				custom: [
					p.series === p.kernel ? "" : ` · ${p.kernel} · ${p.threads}T`,
				],
			})),
			{
				order,
				color: (s) => ink.get(s) as string,
				xs: sizes,
				labels: showLabels,
				hovertemplate:
					"<b>%{y:.1f} GOP/s</b>  %{fullData.name}%{customdata[0]}<extra></extra>",
			},
		),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
		},
	};
};

type RatioPoint = {
	n: number;
	kernel: string;
	counterpart: string;
	threads: number;
	ratio: number;
};

/**
 * Each GPU kernel divided by the best row of its COUNTERPART family at the
 * same size: where the GPU wins for the same engineering effort.
 */
export const gpuEqualEffort: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	const best = new Map(
		[...new Set(kernelPoints.map((p) => counterpartOf(p.kernel)))].map(
			(family) => [family, familyBest(rows, ctx, family)] as const,
		),
	);
	const points: RatioPoint[] = kernelPoints.flatMap((p) => {
		const cpu = best.get(counterpartOf(p.kernel))?.get(p.n);
		// A size the counterpart never ran is a gap, never a NaN point.
		if (!cpu) return [];
		const ratio = p.gops / Number(cpu.gops);
		if (!Number.isFinite(ratio)) return [];
		return [
			{
				n: p.n,
				kernel: p.kernel,
				counterpart: String(cpu.kernel),
				threads: Number(cpu.threads),
				ratio,
			},
		];
	});
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.kernel))].sort();
	const showLabels = present.length <= 4;

	// Ratios of different kernels converge (f32 N=4096: metal-naive 1.68×,
	// mps 1.60×), so end labels closer than LABEL_GAP× share one line of text
	// instead of printing over each other.
	// ponytail: a fixed gap assumes the axis spans ~2–3 decades, as it does on
	// this data; derive it from the scale if labels collide again.
	const LABEL_GAP = 1.25;
	const labels: { n: number; ratio: number; text: string }[] = [];
	const ends = points
		.filter((p) => p.n === sizes[sizes.length - 1])
		.sort((a, b) => a.ratio - b.ratio);
	for (const p of ends) {
		const below = labels.at(-1);
		if (below && p.ratio / below.ratio < LABEL_GAP) {
			below.text += ` · ${p.kernel}`;
		} else {
			labels.push({ n: p.n, ratio: p.ratio, text: p.kernel });
		}
	}

	const lines = lineTraces(
		points.map(
			(p): SeriesPoint => ({
				series: p.kernel,
				x: p.n,
				y: p.ratio,
				custom: [p.counterpart, p.threads],
			}),
		),
		{
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			xs: sizes,
			hovertemplate:
				"<b>%{y:.2f}×</b>  %{fullData.name} ÷ %{customdata[0]} · %{customdata[1]}T<extra></extra>",
		},
	);

	return {
		data: [
			...lines,
			// The end labels ride in their own text-only trace: a merged label
			// names two kernels, so it cannot belong to either one's line.
			...(showLabels
				? [
						{
							type: "scatter" as const,
							mode: "text",
							uid: "labels",
							showlegend: false,
							hoverinfo: "skip" as const,
							cliponaxis: false,
							x: labels.map((l) => l.n),
							y: labels.map((l) => l.ratio),
							text: labels.map((l) => l.text),
							textposition: "middle right" as const,
							textfont: { color: LABEL_INK, size: 11 },
						},
					]
				: []),
		],
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: {
				...AXIS,
				type: "log",
				// Plain numbers: 0.4, never 400m.
				tickformat: "~g",
				title: { text: "× vs CPU at equal effort" },
			},
			// Ratio 1.0, where the GPU starts to win: a shape, so no legend entry
			// or hover. Shape y is in data units even on a log axis.
			shapes: [
				{
					type: "line",
					xref: "paper",
					x0: 0,
					x1: 1,
					y0: 1,
					y1: 1,
					line: { color: REFERENCE_INK, dash: "dash", width: 1.5 },
				},
			],
		},
	};
};

/**
 * The share of end-to-end time spent outside the GPU dispatch: copying the
 * inputs in, encoding, and copying the result out. Copies grow as N² and
 * arithmetic as N³, so the share falls at large sizes.
 */
export const gpuCopyOverhead: ChartSpec = (rows, _f, ctx) => {
	// The same best-per-(kernel, n) rows the kernel chart plots. A row with no
	// GPU-only twin (gpu_ms null) has nothing to subtract, so it is skipped.
	const points: SeriesPoint[] = bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" &&
				r.gpu_ms != null &&
				ctx.palette.has(String(r.kernel)),
		)
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.n),
			y:
				((Number(r.median_ms) - Number(r.gpu_ms)) / Number(r.median_ms)) * 100,
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	const sizes = log2Ticks(points.map((p) => p.x));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.series))].sort();
	const showLabels = present.length <= 4;

	return {
		data: lineTraces(points, {
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			xs: sizes,
			labels: showLabels,
			hovertemplate:
				"<b>%{y:.1f}%</b> copies + encoding  %{fullData.name}<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			// Includes 0 so the share reads against a true baseline, but is never
			// clamped there: a negative share in contributed data stays visible.
			yaxis: {
				...AXIS,
				type: "linear",
				rangemode: "tozero",
				title: { text: "% of end-to-end time" },
			},
		},
	};
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/charts/gpu.test.ts src/lib/charts/index.test.ts`
Expected: all pass.

Run: `bun test`
Expected: `113 pass, 0 fail`.

- [ ] **Step 5: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/charts/gpu.ts src/lib/charts/gpu.test.ts src/lib/charts/index.test.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 6: Browser checks**

1. Reload the preview, then run TAB_WALK. Expected: `errs` is `[]`, and the three GPU panels are:
   - `plotly(metal-naive,metal-tiled,mps,AMX,parallel CPU)`
   - `plotly(metal-naive,metal-tiled,mps)`
   - `plotly(metal-naive,metal-tiled,mps)`
2. Click "GPU" with the `f32` pill on, then run HOVER. Expected rows at N = 1024, for example:
   - `"327.6 GOP/s  metal-naive"` and `"197.2 GOP/s  parallel CPU · rayon-ikj · 10T"`;
   - `"0.89×  mps ÷ accelerate-blas · 1T"`;
   - `"22.4% copies + encoding  mps"`.
3. Run this snippet, which checks that the ratio reference sits at y = 1:

   ```js
   const gd = document.querySelectorAll(".js-plotly-plot")[1];
   const ya = gd._fullLayout.yaxis;
   const d = gd.querySelector(".shapelayer path").getAttribute("d");
   ({ shapeY: Number(d.match(/M[\d.]+,([\d.]+)/)[1]), expected: +(ya._offset + ya.l2p(0)).toFixed(1), labels: gd._fullData.find((t) => t.uid === "labels")?.text });
   ```

   Expected:
   - `shapeY` is within 0.5 of `expected` (about 114.7 at the default size);
   - `labels` is `["mps · metal-naive", "metal-tiled"]`, or the equivalent for the current data.

- [ ] **Step 7: Commit**

From the repo root:

```bash
git add web/src/lib/charts/gpu.ts web/src/lib/charts/gpu.test.ts web/src/lib/charts/index.test.ts
git commit -m "Port the GPU tab to Plotly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Port the block-size sweep

**Files:**
- Modify: `web/src/lib/charts/blocksize.ts` (whole file)
- Test: `web/src/lib/charts/blocksize.test.ts`: seven tests

**Interfaces:**
- Consumes: `AXIS`, `BASE_LAYOUT`, `LABELLED_MARGIN`, `lineTraces`, `log2Axis` and `log2Ticks` (Task 1); `legendOf`, `plotted` and `pointsOf` (fixtures).
- Produces: `blockSizeSweep` typed `ChartSpec`. After this task no chart uses `PlotChartSpec`.

- [ ] **Step 1: Update the tests (failing)**

In `web/src/lib/charts/blocksize.test.ts`, change the fixtures import to:

```ts
import { legendOf, plotted, pointsOf, row } from "../fixtures";
```

In each test below, keep the fixture. Replace everything from the `const spec = blockSizeSweep(` line to the end of the test with the code shown.

`"pins n: a row at a different size does not leak into the sweep"`:

```ts
	const spec = blockSizeSweep(otherSize, f, makeCtx(otherSize));
	expect(spec).not.toBeNull();
	// block_size=128 exists only at n=1024, which f.n=512 must exclude.
	expect(spec?.layout.xaxis?.tickvals).toEqual([32, 64]);
	expect(pointsOf(spec, "tiled").some((p) => p.x === 128)).toBe(false);
});
```

`"takes the best result per (kernel, block_size), not an arbitrary thread row"`:

```ts
	const spec = blockSizeSweep(withThreads, f, makeCtx(withThreads));
	const at32 = pointsOf(spec, "rayon-ikj").find((p) => p.x === 32);
	// 90 is the best of the two threads=1/threads=4 rows at block_size=32;
	// a bug that pinned threads instead of taking the max would report 10.
	expect(at32?.y).toBe(90);
});
```

`"a kernel missing a block size gets an explicit gap, not a line straight through it"`:

```ts
	const spec = blockSizeSweep(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	const gap = pointsOf(spec, "ikj").find((p) => p.x === 64);
	expect(gap?.y).toBeNull();
});
```

`"a kernel with only one block size is excluded, even at a dominant gops"`:

```ts
	const spec = blockSizeSweep(withDominant, f, makeCtx(withDominant));
	expect(spec).not.toBeNull();
	const maxPlotted = Math.max(...plotted(spec).map((p) => Number(p.y)));
	// 660 (mps) must not leak into the plotted range; the swept kernels top
	// out at tiled's 50.
	expect(maxPlotted).toBe(50);
	expect(legendOf(spec).names).not.toContain("mps");
});
```

`"the legend lists only the kernels actually plotted"`: keep the multi-line `const spec = blockSizeSweep(withUnplottedKernel, f, makeCtx(withUnplottedKernel));` statement, and replace everything after it (the `not.toBeNull`, the `if (!spec) return;` and both `spec.color` assertions) with:

```ts
	const { names } = legendOf(spec);
	expect(names).toEqual(expect.arrayContaining(["tiled", "ikj"]));
	expect(names).toHaveLength(2);
});
```

`"a row without a block size is never plotted"`:

```ts
	const spec = blockSizeSweep(withNull, f, makeCtx(withNull));
	expect(spec).not.toBeNull();
	expect(plotted(spec).every((p) => Number(p.x) > 0)).toBe(true);
});
```

`"a kernel with old @64 and new null rows is still excluded as single-block-size"`:

```ts
	const spec = blockSizeSweep(mixedOldAndNew, f, makeCtx(mixedOldAndNew));
	expect(spec).not.toBeNull();
	expect(legendOf(spec).names).not.toContain("mps");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/charts/blocksize.test.ts`
Expected: FAIL in the changed tests.

- [ ] **Step 3: Replace `blocksize.ts`**

Replace the whole of `web/src/lib/charts/blocksize.ts` with:

```ts
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
} from "./types";

type BlockPoint = { block_size: number; kernel: string; gops: number };

/**
 * One line per kernel: x is block size, so the best (kernel, block_size)
 * result at the pinned N — the same reason the size chart pins nothing but
 * takes each kernel's best across threads, only here threads AND n are both
 * pinned by the caller's row scoping / f.n filter.
 */
export const blockSizeSweep: ChartSpec = (rows, f, ctx) => {
	// ctx.singleBlockSize is the same predicate rowsForTab uses to *keep* a
	// one-block-size kernel (e.g. mps) visible on pinned tabs — there it's a
	// valid measurement to show. Here it's the opposite: a kernel with nothing
	// to sweep contributes no comparison, only a lone point that can dominate
	// the linear y-axis and squash the kernels that do vary.
	const atSize = rows.filter(
		(r) =>
			r.block_size != null &&
			Number(r.n) === f.n &&
			ctx.palette.has(String(r.kernel)) &&
			!ctx.singleBlockSize.has(String(r.kernel)),
	);

	const best = new Map<string, BlockPoint>();
	for (const r of atSize) {
		const key = `${r.kernel}\u0000${r.block_size}`;
		const current = best.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops) {
			best.set(key, {
				block_size: Number(r.block_size),
				kernel: String(r.kernel),
				gops,
			});
		}
	}
	const points = [...best.values()];
	const sizes = log2Ticks(points.map((p) => p.block_size));
	if (sizes.length < 2) return null;

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw.
	const present = [...new Set(points.map((p) => p.kernel))];
	const showLabels = present.length <= 4;

	return {
		data: lineTraces(
			points.map((p) => ({
				series: p.kernel,
				x: p.block_size,
				y: p.gops,
				custom: [],
			})),
			{
				order: present,
				color: (k) => ctx.palette.get(k) as string,
				xs: sizes,
				labels: showLabels,
				hovertemplate: "<b>%{y:.1f} GOP/s</b>  %{fullData.name}<extra></extra>",
			},
		),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "Block size"),
			yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
		},
	};
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/charts/blocksize.test.ts`
Expected: `10 pass, 0 fail`.

Run: `bun test`
Expected: `113 pass, 0 fail`.

- [ ] **Step 5: Lint and type gate**

Run: `bunx @biomejs/biome check --write src/lib/charts/blocksize.ts src/lib/charts/blocksize.test.ts`
Expected: no errors.

Run: `bun run check 2>&1 | grep ' ERROR ' | grep -v '\.test\.ts'`
Expected: no output.

Run: `grep -rn "PlotChartSpec" src/lib/charts/*.ts`
Expected: only `types.ts` (the definition) and `index.ts` (the import and the union).

- [ ] **Step 6: Browser checks**

1. Reload the preview, then run TAB_WALK. Expected:
   - `errs` is `[]`.
   - The Block size panel is `plotly(...)`, listing the swept tiled kernels and never `mps`.
   - Every panel on every tab is now `plotly`.

- [ ] **Step 7: Commit**

From the repo root:

```bash
git add web/src/lib/charts/blocksize.ts web/src/lib/charts/blocksize.test.ts
git commit -m "Port the block-size sweep to Plotly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Remove Observable Plot and document the Plotly dashboard

**Files:**
- Modify: `web/package.json`, `web/bun.lock` (via `bun remove`)
- Modify: `web/src/lib/charts/types.ts`: delete `PlotSpec`, `PlotChartSpec`, `breakGaps`, `BASE`; fix one comment
- Modify: `web/src/lib/charts/index.ts` (`Panel.spec`)
- Modify: `web/src/lib/Chart.svelte` (the `<script>` block)
- Modify: `README.md` (the Web Dashboard paragraph)

**Interfaces:**
- Consumes: every chart typed `ChartSpec` (Tasks 2–7).
- Produces:
  - `ChartSpec` is the only spec type.
  - `Chart.svelte` prop `spec: Figure | null`.
  - No `@observablehq/plot` anywhere.

- [ ] **Step 1: Prove Plot is now dead code outside the transitional scaffolding**

Run from `web/`:

```bash
grep -rnE "PlotSpec|PlotChartSpec|breakGaps|observablehq|Plot\.plot" src; grep -rnw BASE src
```

Expected, only these hits:
- `src/lib/charts/types.ts`: the `PlotSpec`, `PlotChartSpec`, `breakGaps` and `BASE` definitions.
- `src/lib/charts/index.ts`: the `PlotChartSpec` import and the union.
- `src/lib/Chart.svelte`: the Plot import, `PlotSpec`, `isFigure` and `Plot.plot`.

- [ ] **Step 2: Delete the transitional types and helpers**

In `web/src/lib/charts/types.ts`:
- Delete the `PlotSpec` type together with its doc comment, which starts `/**\n * Derived from Plot.plot's own signature`.
- Delete the `PlotChartSpec` type together with its doc comment, `/** A chart not yet ported to Plotly. Deleted once every chart is. */`.
- Delete the `breakGaps` function together with its doc comment, which starts `/**\n * Plot's line mark draws straight through a missing point`.
- Delete `BASE` together with its doc comment, `/** Shared axis/mark defaults: recessive grid, 2px lines, generous margins. */`.
- Change the `log2Ticks` doc comment to `/** Ticks at the sizes actually measured, not at Plotly's chosen log decades. */`.

In `web/src/lib/charts/index.ts`, change the import back to

```ts
import type { ChartSpec, Ctx, Filters } from "./types";
```

and in `interface Panel`, change `spec: ChartSpec | PlotChartSpec;` back to `spec: ChartSpec;`.

- [ ] **Step 3: Drop the Plot branch from the renderer**

In `web/src/lib/Chart.svelte`, replace the whole `<script lang="ts"> … </script>` block with:

```svelte
<script lang="ts">
import type { Config } from "plotly.js-dist-min";
import Plotly from "plotly.js-dist-min";
import { escapeLabels, type Figure } from "./charts/types";

let {
	spec,
	title,
	note = "",
	empty = "No data for this selection.",
}: {
	spec: Figure | null;
	title: string;
	note?: string;
	empty?: string;
} = $props();

let host = $state<HTMLDivElement | null>(null);

/**
 * Plotly's built-ins are why the dashboard uses it: box zoom and pan,
 * double-click to reset, legend click to hide and double-click to isolate,
 * and an SVG download. The selection tools have nothing to act on, and the
 * cloud-upload button, on by default since Plotly 4, would post the chart's
 * data to cloud.plotly.com.
 */
const CONFIG: Partial<Config> = {
	displaylogo: false,
	showSendToCloud: false,
	modeBarButtonsToRemove: ["select2d", "lasso2d"],
};

$effect(() => {
	if (!host || !spec) return;
	// A copy: Plotly writes zoom state back into the layout it is handed, and
	// charts share BASE_LAYOUT's nested objects.
	const { data, layout } = escapeLabels(structuredClone(spec));
	Plotly.react(
		host,
		data,
		{
			...layout,
			// A hidden series stays hidden across filter changes (traces are
			// matched by uid); zoom resets, since the axes may hold new data.
			legend: { ...layout.legend, uirevision: title },
		},
		{ ...CONFIG, toImageButtonOptions: { format: "svg", filename: title } },
	);
});

// Its own effect: a cleanup in the draw effect would run before every redraw
// and throw away the zoom and legend state react preserves.
$effect(() => {
	const el = host;
	if (!el) return;
	// Follows the panel, not only the window (which is all Plotly's
	// `responsive` watches): the page scrollbar that appears once the charts
	// load narrows every panel without a window resize. Plots.resize rejects
	// on a div Plotly has not drawn into yet.
	const resize = new ResizeObserver(() => {
		if (el.classList.contains("js-plotly-plot")) Plotly.Plots.resize(el);
	});
	resize.observe(el);
	return () => {
		resize.disconnect();
		Plotly.purge(el);
	};
});
</script>
```

- [ ] **Step 4: Remove the dependency**

Run from `web/`:

```bash
bun remove @observablehq/plot
```

Then run `grep -rnE "observablehq|PlotSpec|PlotChartSpec|breakGaps" src package.json; grep -rnw BASE src`.
Expected: no output.

- [ ] **Step 5: Update the README**

In `README.md` (Web Dashboard section), replace the paragraph that begins `It loads \`web/public/results.parquet\` into DuckDB-WASM in the browser and charts it with [Observable Plot]` with:

```markdown
It loads `web/public/results.parquet` into DuckDB-WASM in the browser and charts it with [Plotly.js](https://plotly.com/javascript/) in six tabs: Overview (one line per kernel family), CPU & AMX, CPU threading, Precision, GPU, and Block size. Pickers narrow each tab by precision, matrix size, block size, or kernel, and a Relative toggle switches to speedup (over `naive-ijk` on CPU & AMX, over one thread on CPU threading). Every chart has Plotly's built-ins: drag to zoom and double-click to reset, click a legend entry to hide that series or double-click it to show only that one, hover for every series' value at that point, and download the chart as SVG from its toolbar. A hidden series stays hidden while you change pickers. GPU kernels are charted with their end-to-end (`-e2e`) timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the GPU-only share as copy overhead. Charts that span kernel families colour by family, and per-kernel charts show either host or GPU kernels, never both. Chart definitions live in `web/src/lib/charts/` as pure functions that return Plotly JSON, each with a `bun test` suite next to it.
```

- [ ] **Step 6: Full verification**

Run from `web/`, in order:

`bun test`
Expected: `113 pass, 0 fail`.

`bunx @biomejs/biome check --write src`
Expected: no errors. The only warning is the existing `noNonNullAssertion` in `src/main.ts`.

`bun run check 2>&1 | grep ' ERROR ' | grep -v "bun:test"`
Expected: no output. The test files type-check now; the only remaining errors are the eight "Cannot find module 'bun:test'" lines, one per suite.

`bun run build`
Expected: `✓ built`, with no chunk-size warning.

From the repo root: `just check && just test`
Expected: both succeed. (`just check` also runs clippy on the Rust crate; it is unaffected, but the repo's pre-push rule asks for both.)

- [ ] **Step 7: Final browser pass**

Reload the preview, then:

1. Run TAB_WALK. Expected: `errs` is `[]`, and every panel on every tab is `plotly(...)`.
2. Click "Overview" and run CHROME. Expected:
   - `buttons` is exactly `["Download plot","Zoom","Pan","Zoom in","Zoom out","Autoscale","Reset axes"]`;
   - `logo` is `false`;
   - each `widths` pair is equal.
3. Resize the pane to the `tablet` preset (`resize_window`), wait 1 s, and run CHROME again. Expected: each `widths` pair is still equal, at the new width. Then reset with preset `desktop`.
4. Repeat Task 2's legend, zoom and precision checks (Step 10, items 4–6) on "Throughput by family". Expected: a hidden series survives the pill change, and the zoom resets.
5. Take a screenshot of each tab and look for label collisions, clipped end labels, and legend overflow.

- [ ] **Step 8: Commit**

From the repo root:

```bash
git add web/package.json web/bun.lock web/src/lib/charts/types.ts web/src/lib/charts/index.ts web/src/lib/Chart.svelte README.md
git commit -m "Remove Observable Plot and document the Plotly dashboard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

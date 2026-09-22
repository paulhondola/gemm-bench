# Benchmark Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `web/`'s single-slice results table with a tabbed dashboard whose every panel, tab, and control value is derived from the rows present in `results.parquet`.

**Architecture:** One `SELECT *` at boot loads all 677 rows into memory; everything downstream is a synchronous derivation over that array. A chart is a pure function `(rows, filters, ctx) => PlotSpec | null`, and returning `null` *is* the mechanism that hides a chart, a control, or a whole tab. Observable Plot renders the spec; one `Chart.svelte` component is the only code that touches the DOM.

**Tech Stack:** Svelte 5.57 (runes), TypeScript 6, Vite 8, `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (already present), `@observablehq/plot` 0.6.17 (new), `bun test`, Biome 2.5.13.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-design.md`

## Global Constraints

- **Dark theme only.** Page `#0e1012`, panel `#15181b`, border `#24292e`, primary ink `#e6e3dc`, muted `#9aa1a8`, accent `#e8743b`. Radii 10px panels, 8px control groups, 6px buttons, 16px pills. Fonts: IBM Plex Sans (prose), IBM Plex Mono (numbers, headings).
- **Series colours are the eight validated slots, in this fixed order**, and may not be substituted, re-stepped, or extended with a generated hue: `#3987e5`, `#d95926`, `#199e70`, `#c98500`, `#d55181`, `#008300`, `#9085e9`, `#e66767`.
- **Colour keys off the kernel name, computed from the full dataset** — never from the filtered subset. Filtering must never repaint the survivors.
- **Dashes are reserved** for `mps` and for reference lines (ideal-linear, ratio=1.0). Never for kernel identity.
- **The throughput column is `gops`**, displayed as `GOP/s`. Never `gflops` or `GFLOP/s`.
- **A module using runes must be named `*.svelte.ts`.** Svelte 5 does not compile `$state`/`$derived` in a plain `.ts` file.
- **No new runtime dependency beyond `@observablehq/plot`.** No DOM test harness, no charting wrapper, no date library.
- **Never edit a file under `data/runs/`.** Nothing in this plan touches the benchmark crate, the CSV schema, or `data/build.sql`.

---

### Task 1: Tooling foundation

Makes `bun test` real, installs Plot, and stops Biome reporting every template-only variable as unused.

**Files:**
- Create: `web/biome.json`
- Create: `web/src/lib/derive.test.ts`
- Create: `web/src/lib/derive.ts`
- Modify: `web/package.json` (dependencies)
- Modify: `justfile` (the `test` target, lines 25-27)

**Interfaces:**
- Consumes: nothing.
- Produces: `just test-web` runs `bun test` in `web/`; `just test` runs both halves.

- [ ] **Step 1: Install Observable Plot**

```bash
cd web && bun add @observablehq/plot@0.6.17
```

- [ ] **Step 2: Add the Biome config**

Biome parses only the `<script>` block of a `.svelte` file, never the template, so props and `$derived` values used only in markup are reported unused. Two such false positives already exist in `App.svelte`.

Create `web/biome.json`:

```json
{
	"$schema": "https://biomejs.dev/schemas/2.5.13/schema.json",
	"overrides": [
		{
			"includes": ["**/*.svelte"],
			"linter": {
				"rules": {
					"correctness": {
						"noUnusedVariables": "off",
						"noUnusedImports": "off"
					}
				}
			}
		}
	]
}
```

- [ ] **Step 3: Write the failing test**

Create `web/src/lib/derive.test.ts`:

```ts
import { expect, test } from "bun:test";
import { precisions } from "./derive";
import type { Row } from "./db";

const rows: Row[] = [
	{ kernel: "ikj", precision: "f32", n: 64, threads: 1, gops: 10, backend: "cpu" },
	{ kernel: "ikj", precision: "f16", n: 64, threads: 1, gops: 20, backend: "cpu" },
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd web && bun test
```

Expected: FAIL — `Export named 'precisions' not found in module .../derive.ts` (the module does not exist yet).

- [ ] **Step 5: Write the minimal implementation**

Create `web/src/lib/derive.ts`:

```ts
import type { Row } from "./db";

/** Every precision present in the rows, once each, sorted. */
export function precisions(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.precision)))].sort();
}
```

- [ ] **Step 6: Run the test and watch it pass**

```bash
cd web && bun test
```

Expected: PASS — 1 pass, 0 fail.

- [ ] **Step 7: Wire it into the justfile**

Replace lines 25-27 of `justfile`:

```make
test: test-bench test-web

test-bench:
    cargo test --manifest-path benchmark/Cargo.toml

test-web:
    cd web && bun test
```

- [ ] **Step 8: Verify the full gate passes**

```bash
just test && just check
```

Expected: Rust tests pass, `bun test` passes, clippy clean, `tsc --noEmit` clean.

- [ ] **Step 9: Commit**

```bash
git add web/biome.json web/package.json web/bun.lock web/src/lib/derive.ts web/src/lib/derive.test.ts justfile
git commit -m "Add web test target, Plot, and Biome svelte overrides"
```

---

### Task 2: Family, facets, and defaults

The data-derived vocabulary the whole dashboard reads from: which kernels are serial/parallel/gpu, which sizes exist for a precision, and what the landing view selects.

**Files:**
- Modify: `web/src/lib/derive.ts`
- Modify: `web/src/lib/derive.test.ts`

**Interfaces:**
- Consumes: `precisions(rows: Row[]): string[]` from Task 1.
- Produces:
  - `type Family = "serial" | "parallel" | "gpu"`
  - `families(rows: Row[]): Map<string, Family>`
  - `kernels(rows: Row[]): string[]`
  - `sizesFor(rows: Row[], precision: string): number[]`
  - `allSizes(rows: Row[]): number[]`
  - `threadsFor(rows: Row[], precision: string, n: number): number[]`
  - `defaultPrecision(rows: Row[]): string`
  - `defaultSize(rows: Row[], precision: string): number`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/derive.test.ts`:

```ts
import {
	allSizes,
	defaultPrecision,
	defaultSize,
	families,
	sizesFor,
} from "./derive";

const mixed: Row[] = [
	{ kernel: "ikj", precision: "f32", n: 64, threads: 1, gops: 10, backend: "cpu" },
	{ kernel: "ikj", precision: "f32", n: 128, threads: 1, gops: 12, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 1, gops: 10, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 4, gops: 38, backend: "cpu" },
	{ kernel: "mps", precision: "f32", n: 64, threads: 1, gops: 2, backend: "metal" },
	{ kernel: "ikj", precision: "i64", n: 4096, threads: 1, gops: 6, backend: "cpu" },
];

test("family comes from the data, not the kernel name", () => {
	const f = families(mixed);
	expect(f.get("ikj")).toBe("serial");
	expect(f.get("rayon-ikj")).toBe("parallel");
	expect(f.get("mps")).toBe("gpu");
});

test("a metal kernel stays gpu even with only single-thread rows", () => {
	expect(families([
		{ kernel: "mps", precision: "f32", n: 64, threads: 1, gops: 2, backend: "metal" },
	]).get("mps")).toBe("gpu");
});

test("sizesFor narrows to the precision; allSizes does not", () => {
	expect(sizesFor(mixed, "f32")).toEqual([64, 128]);
	expect(sizesFor(mixed, "i64")).toEqual([4096]);
	expect(allSizes(mixed)).toEqual([64, 128, 4096]);
});

test("defaults prefer f32 and the largest size that precision has", () => {
	expect(defaultPrecision(mixed)).toBe("f32");
	expect(defaultSize(mixed, "f32")).toBe(128);
});

test("without f32, the default precision is the one with the widest coverage", () => {
	const noF32 = mixed.filter((r) => r.precision !== "f32");
	expect(defaultPrecision(noF32)).toBe("i64");
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — `families`, `sizesFor`, `allSizes`, `defaultPrecision`, `defaultSize` are not exported.

- [ ] **Step 3: Implement**

Append to `web/src/lib/derive.ts`:

```ts
export type Family = "serial" | "parallel" | "gpu";

/**
 * Kernel family, read off the rows rather than the kernel's name. A prefix
 * heuristic would break on the first kernel named differently; a kernel is
 * parallel because the harness produced multi-thread rows for it.
 */
export function families(rows: Row[]): Map<string, Family> {
	const out = new Map<string, Family>();
	for (const r of rows) {
		const kernel = String(r.kernel);
		if (r.backend === "metal") {
			out.set(kernel, "gpu");
			continue;
		}
		if (out.get(kernel) === "gpu") continue;
		if (Number(r.threads) > 1 || out.get(kernel) === "parallel") {
			out.set(kernel, "parallel");
		} else if (!out.has(kernel)) {
			out.set(kernel, "serial");
		}
	}
	return out;
}

export function kernels(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.kernel)))].sort();
}

const ascending = (a: number, b: number) => a - b;

export function sizesFor(rows: Row[], precision: string): number[] {
	return [
		...new Set(
			rows.filter((r) => r.precision === precision).map((r) => Number(r.n)),
		),
	].sort(ascending);
}

export function allSizes(rows: Row[]): number[] {
	return [...new Set(rows.map((r) => Number(r.n)))].sort(ascending);
}

export function threadsFor(rows: Row[], precision: string, n: number): number[] {
	return [
		...new Set(
			rows
				.filter((r) => r.precision === precision && Number(r.n) === n)
				.map((r) => Number(r.threads)),
		),
	].sort(ascending);
}

/**
 * f32 when present — it is the CLI default and the canonical comparison.
 * Otherwise the precision covering the most sizes, so the landing chart has
 * the widest x-axis it can. Name order breaks ties so the choice is stable.
 */
export function defaultPrecision(rows: Row[]): string {
	const available = precisions(rows);
	if (available.includes("f32")) return "f32";
	return (
		available
			.slice()
			.sort(
				(a, b) =>
					sizesFor(rows, b).length - sizesFor(rows, a).length ||
					a.localeCompare(b),
			)[0] ?? ""
	);
}

/** The largest size the selected precision actually has, not the largest overall. */
export function defaultSize(rows: Row[], precision: string): number {
	const sizes = sizesFor(rows, precision);
	return sizes[sizes.length - 1] ?? 0;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test
```

Expected: PASS — 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/derive.ts web/src/lib/derive.test.ts
git commit -m "Derive kernel family, size facets, and landing defaults from the rows"
```

---

### Task 3: Best-per-kernel and baseline detection

The comparison basis for every kernel-vs-kernel chart, plus the two guards that decide whether a speedup projection can be offered at all.

**Files:**
- Modify: `web/src/lib/derive.ts`
- Modify: `web/src/lib/derive.test.ts`

**Interfaces:**
- Consumes: `Row` from `./db`.
- Produces:
  - `bestPerKernel(rows: Row[]): Row[]` — one row per `(kernel, n)`, the highest `gops`
  - `hasKernel(rows: Row[], kernel: string): boolean`
  - `hasSingleThreadBaseline(rows: Row[]): boolean`
  - `BASELINE_KERNEL = "naive-ijk"`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/derive.test.ts`:

```ts
import {
	BASELINE_KERNEL,
	bestPerKernel,
	hasKernel,
	hasSingleThreadBaseline,
} from "./derive";

const threaded: Row[] = [
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 1, gops: 10, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 4, gops: 38, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 8, gops: 31, backend: "cpu" },
	{ kernel: "ikj", precision: "f32", n: 64, threads: 1, gops: 12, backend: "cpu" },
];

test("bestPerKernel keeps the peak per kernel and size", () => {
	const best = bestPerKernel(threaded);
	expect(best).toHaveLength(2);
	const rayon = best.find((r) => r.kernel === "rayon-ikj");
	expect(rayon?.gops).toBe(38);
	expect(rayon?.threads).toBe(4);
});

test("bestPerKernel keeps serial kernels in frame", () => {
	// The bug this guards: pinning a thread count would drop every kernel
	// that only ever has threads=1 rows.
	expect(bestPerKernel(threaded).map((r) => r.kernel).sort()).toEqual([
		"ikj",
		"rayon-ikj",
	]);
});

test("bestPerKernel keeps the first row on a tie", () => {
	const tied: Row[] = [
		{ kernel: "ikj", precision: "f32", n: 64, threads: 1, gops: 10, backend: "cpu" },
		{ kernel: "ikj", precision: "f32", n: 64, threads: 2, gops: 10, backend: "cpu" },
	];
	expect(bestPerKernel(tied)[0].threads).toBe(1);
});

test("bestPerKernel returns nothing for no rows", () => {
	expect(bestPerKernel([])).toEqual([]);
});

test("baseline guards detect what a partial sweep is missing", () => {
	expect(hasKernel(threaded, BASELINE_KERNEL)).toBe(false);
	expect(hasSingleThreadBaseline(threaded)).toBe(true);
	expect(hasSingleThreadBaseline(threaded.filter((r) => r.threads !== 1))).toBe(
		false,
	);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — `bestPerKernel`, `hasKernel`, `hasSingleThreadBaseline`, `BASELINE_KERNEL` are not exported.

- [ ] **Step 3: Implement**

Append to `web/src/lib/derive.ts`:

```ts
/** The kernel every speedup projection is expressed against. */
export const BASELINE_KERNEL = "naive-ijk";

/**
 * One row per (kernel, n): the kernel's best result at that size, whatever
 * thread count produced it. Pinning a thread count instead would drop every
 * serial kernel, since those only ever have threads=1 rows.
 *
 * A strict `>` keeps the first row on a tie, so the result is stable.
 */
export function bestPerKernel(rows: Row[]): Row[] {
	const best = new Map<string, Row>();
	for (const r of rows) {
		const key = `${r.kernel}\u0000${r.n}`;
		const current = best.get(key);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(key, r);
	}
	return [...best.values()];
}

export function hasKernel(rows: Row[], kernel: string): boolean {
	return rows.some((r) => r.kernel === kernel);
}

/** A speedup-vs-1-thread projection needs a 1-thread row to divide by. */
export function hasSingleThreadBaseline(rows: Row[]): boolean {
	return rows.some((r) => Number(r.threads) === 1);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test
```

Expected: PASS — 11 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/derive.ts web/src/lib/derive.test.ts
git commit -m "Add best-per-kernel selection and speedup baseline guards"
```

---

### Task 4: The palette

Eight validated slots assigned in fixed order, computed once from the full dataset so filtering never repaints a surviving series.

**Files:**
- Create: `web/src/lib/palette.ts`
- Create: `web/src/lib/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_SERIES: 8`
  - `paletteFor(allKernels: string[]): Map<string, string>`
  - `REFERENCE_INK = "#5b636b"` (ideal-linear and ratio=1.0 rules)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/palette.test.ts`:

```ts
import { expect, test } from "bun:test";
import { MAX_SERIES, paletteFor } from "./palette";

const all = [
	"ikj",
	"mps",
	"naive-ijk",
	"rayon-ikj",
	"rayon-tiled",
	"static-ikj",
	"static-tiled",
	"tiled",
];

test("known kernels take their documented slot", () => {
	const p = paletteFor(all);
	expect(p.get("naive-ijk")).toBe("#3987e5");
	expect(p.get("ikj")).toBe("#d95926");
	expect(p.get("tiled")).toBe("#199e70");
	expect(p.get("mps")).toBe("#e66767");
});

test("colour follows the kernel, not its rank", () => {
	// The palette is built from the whole dataset, so hiding a series in the
	// legend must not repaint the ones that remain.
	const full = paletteFor(all);
	const fewer = paletteFor(all);
	expect(fewer.get("mps")).toBe(full.get("mps"));
});

test("an unknown kernel is appended, never cycled into an occupied slot", () => {
	const p = paletteFor([...all.slice(0, 7), "accelerate"]);
	expect(p.get("accelerate")).toBe("#e66767");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("beyond eight kernels the map caps rather than generating a hue", () => {
	const p = paletteFor([...all, "accelerate", "packed-simd"]);
	expect(p.size).toBe(MAX_SERIES);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — module `./palette` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/lib/palette.ts`:

```ts
/**
 * The eight validated categorical slots for the dark surface (#15181b).
 * Worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3, all eight
 * at or above 3:1 contrast. Do not substitute or re-step these values, and
 * never extend the list with a generated hue: a ninth series folds into the
 * best-per-family view instead.
 */
const SLOTS = [
	"#3987e5", // 1 blue
	"#d95926", // 2 orange
	"#199e70", // 3 aqua
	"#c98500", // 4 yellow
	"#d55181", // 5 magenta
	"#008300", // 6 green
	"#9085e9", // 7 violet
	"#e66767", // 8 red
] as const;

export const MAX_SERIES = SLOTS.length;

/** Muted ink for the ideal-linear and ratio=1.0 reference rules. */
export const REFERENCE_INK = "#5b636b";

/**
 * Fixed assignment order, arranged so the most-compared pairs land on
 * adjacent slots — adjacent pairs are the validated worst case.
 */
const ORDER = [
	"naive-ijk",
	"ikj",
	"tiled",
	"rayon-ikj",
	"static-ikj",
	"rayon-tiled",
	"static-tiled",
	"mps",
];

/**
 * Pass the kernels of the WHOLE dataset, not the filtered subset. Colour
 * follows the entity, so a legend toggle must never repaint the survivors.
 */
export function paletteFor(allKernels: string[]): Map<string, string> {
	const present = new Set(allKernels);
	const known = ORDER.filter((k) => present.has(k));
	const extra = allKernels.filter((k) => !ORDER.includes(k)).sort();
	return new Map(
		[...known, ...extra].slice(0, MAX_SERIES).map((k, i) => [k, SLOTS[i]]),
	);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test
```

Expected: PASS — 15 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/palette.ts web/src/lib/palette.test.ts
git commit -m "Add the validated eight-slot kernel palette"
```

---

### Task 5: Chart types and renderer

The single component that touches the DOM, and the shared vocabulary every chart builder speaks.

**Files:**
- Create: `web/src/lib/charts/types.ts`
- Create: `web/src/lib/Chart.svelte`

**Interfaces:**
- Consumes: `families`, `kernels` (Task 2); `paletteFor` (Task 4).
- Produces:
  - `type PlotSpec`
  - `interface Filters { precision: string; n: number; kernel: string; relative: boolean }`
  - `interface Ctx { palette: Map<string, string>; family: Map<string, Family> }`
  - `type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => PlotSpec | null`
  - `makeCtx(allRows: Row[]): Ctx`
  - `log2Ticks(values: number[]): number[]`
  - `<Chart spec title note />`

- [ ] **Step 1: Create the shared types**

Create `web/src/lib/charts/types.ts`:

```ts
import type { Row } from "../db";
import { type Family, families, kernels } from "../derive";
import { paletteFor } from "../palette";

/**
 * Derived from Plot.plot's own signature rather than an exported type name,
 * so it stays correct across Plot versions.
 */
export type PlotSpec = Parameters<
	typeof import("@observablehq/plot").plot
>[0];

export interface Filters {
	precision: string;
	n: number;
	kernel: string;
	/** true renders the chart's relative projection (speedup / ratio). */
	relative: boolean;
}

export interface Ctx {
	palette: Map<string, string>;
	family: Map<string, Family>;
}

/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[]): Ctx {
	return { palette: paletteFor(kernels(allRows)), family: families(allRows) };
}

/**
 * A chart that cannot be built from these rows returns null. That single
 * convention hides a panel, a projection toggle, and a whole tab.
 */
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => PlotSpec | null;

/** Ticks at the sizes actually measured, not at Plot's chosen log decades. */
export function log2Ticks(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

/** Shared axis/mark defaults: recessive grid, 2px lines, generous margins. */
export const BASE: Partial<PlotSpec> = {
	style: { background: "transparent", color: "#9aa1a8", fontSize: "12px" },
	marginLeft: 64,
	marginBottom: 44,
	grid: true,
};
```

- [ ] **Step 2: Create the renderer**

Create `web/src/lib/Chart.svelte`:

```svelte
<script lang="ts">
import * as Plot from "@observablehq/plot";
import type { PlotSpec } from "./charts/types";

let {
	spec,
	title,
	note = "",
	empty = "No data for this selection.",
}: {
	spec: PlotSpec | null;
	title: string;
	note?: string;
	empty?: string;
} = $props();

let host = $state<HTMLDivElement | null>(null);

$effect(() => {
	if (!host) return;
	host.replaceChildren();
	if (spec) host.append(Plot.plot(spec));
});
</script>

<section class="panel">
	<header>
		<h2>{title}</h2>
		{#if note}<p class="note">{note}</p>{/if}
	</header>
	{#if spec}
		<div class="plot" bind:this={host}></div>
	{:else}
		<p class="empty">{empty}</p>
	{/if}
</section>

<style>
	.panel {
		background: #15181b;
		border: 1px solid #24292e;
		border-radius: 10px;
		padding: 20px 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		color: #e6e3dc;
	}
	.note {
		margin: 4px 0 0;
		font-size: 13px;
		color: #9aa1a8;
	}
	.empty {
		margin: 0;
		padding: 32px 0;
		text-align: center;
		color: #9aa1a8;
		font-size: 13px;
	}
</style>
```

- [ ] **Step 3: Verify it typechecks**

```bash
cd web && bun run typecheck && bunx @biomejs/biome check src
```

Expected: no TypeScript errors; Biome reports no `noUnusedVariables` for `host`, `spec`, `title`, `note`, or `empty` (the Task 1 override covers `.svelte`).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/charts/types.ts web/src/lib/Chart.svelte
git commit -m "Add the chart spec contract and its single DOM renderer"
```

---

### Task 6: Overview charts

**Files:**
- Create: `web/src/lib/charts/overview.ts`
- Create: `web/src/lib/charts/overview.test.ts`

**Interfaces:**
- Consumes: `ChartSpec`, `Ctx`, `Filters`, `BASE`, `log2Ticks` (Task 5); `bestPerKernel`, `hasKernel`, `BASELINE_KERNEL` (Task 3).
- Produces: `throughputVsSize: ChartSpec`, `fastestPerSize: ChartSpec`, `serialOnly: ChartSpec`, `canShowSpeedup(rows: Row[]): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/charts/overview.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { makeCtx, type Filters } from "./types";
import { canShowSpeedup, fastestPerSize, serialOnly, throughputVsSize } from "./overview";

const f: Filters = { precision: "f32", n: 128, kernel: "rayon-ikj", relative: false };

const rows: Row[] = [
	{ kernel: "naive-ijk", precision: "f32", n: 64, threads: 1, gops: 2, backend: "cpu", stddev_ms: 0.1, median_ms: 1 },
	{ kernel: "naive-ijk", precision: "f32", n: 128, threads: 1, gops: 3, backend: "cpu", stddev_ms: 0.1, median_ms: 1 },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 4, gops: 30, backend: "cpu", stddev_ms: 0.1, median_ms: 1 },
	{ kernel: "rayon-ikj", precision: "f32", n: 128, threads: 4, gops: 90, backend: "cpu", stddev_ms: 0.1, median_ms: 1 },
];

test("the headline chart builds when two sizes exist", () => {
	expect(throughputVsSize(rows, f, makeCtx(rows))).not.toBeNull();
});

test("one size is not a trend", () => {
	const single = rows.filter((r) => r.n === 64);
	expect(throughputVsSize(single, f, makeCtx(single))).toBeNull();
});

test("no rows, no chart", () => {
	expect(throughputVsSize([], f, makeCtx([]))).toBeNull();
	expect(fastestPerSize([], f, makeCtx([]))).toBeNull();
	expect(serialOnly([], f, makeCtx([]))).toBeNull();
});

test("the speedup projection needs a naive-ijk baseline", () => {
	expect(canShowSpeedup(rows)).toBe(true);
	expect(canShowSpeedup(rows.filter((r) => r.kernel !== "naive-ijk"))).toBe(false);
});

test("serialOnly drops the parallel kernels", () => {
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	// Assert on the plotted points, not on the whole spec: color.domain always
	// lists every kernel in the dataset so that filtering cannot repaint.
	const plotted = new Set(
		(spec?.marks?.[0] as { data: { kernel: string }[] }).data.map((d) => d.kernel),
	);
	expect(plotted).toEqual(new Set(["naive-ijk"]));
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — module `./overview` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/lib/charts/overview.ts`:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { BASELINE_KERNEL, bestPerKernel, hasKernel } from "../derive";
import { BASE, type ChartSpec, type Ctx, log2Ticks, type PlotSpec } from "./types";

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

function sizeSeries(rows: Row[], ctx: Ctx, relative: boolean): PlotSpec | null {
	const best = bestPerKernel(rows).filter((r) => ctx.palette.has(String(r.kernel)));
	const sizes = log2Ticks(best.map((r) => Number(r.n)));
	if (sizes.length < 2) return null;

	const base = baselineAt(best);
	const points = best
		.map((r) => ({
			n: Number(r.n),
			kernel: String(r.kernel),
			threads: Number(r.threads),
			// gops is 2N^3/median_ms, so the band is that value at median±stddev.
			lo: Number(r.gops) * (Number(r.median_ms) / (Number(r.median_ms) + Number(r.stddev_ms))),
			hi: Number(r.gops) * (Number(r.median_ms) / Math.max(Number(r.median_ms) - Number(r.stddev_ms), 1e-9)),
			y: relative ? Number(r.gops) / (base.get(Number(r.n)) ?? Number.NaN) : Number(r.gops),
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	return {
		...BASE,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: {
			type: "log",
			label: relative ? "× vs naive-ijk" : "GOP/s",
			labelAnchor: "top",
		},
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
			legend: true,
		},
		marks: [
			...(relative
				? []
				: [
						Plot.areaY(points, {
							x: "n",
							y1: "lo",
							y2: "hi",
							fill: "kernel",
							fillOpacity: 0.15,
						}),
					]),
			Plot.line(points, {
				x: "n",
				y: "y",
				stroke: "kernel",
				strokeWidth: 2,
				strokeDasharray: (d: { kernel: string }) =>
					d.kernel === "mps" ? "5 4" : undefined,
			}),
			Plot.dot(points, { x: "n", y: "y", fill: "kernel", r: 4 }),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "y",
					title: (d: { kernel: string; threads: number; y: number }) =>
						`${d.kernel} · ${d.threads}T\n${d.y.toFixed(1)}`,
				}),
			),
		],
	};
}

export const throughputVsSize: ChartSpec = (rows, f, ctx) =>
	sizeSeries(rows, ctx, f.relative && canShowSpeedup(rows));

export const serialOnly: ChartSpec = (rows, _f, ctx) =>
	sizeSeries(
		rows.filter((r) => ctx.family.get(String(r.kernel)) === "serial"),
		ctx,
		false,
	);

/**
 * Computed over every kernel, independent of the headline chart's legend —
 * it summarises the data, not the current view.
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
		gops: Number(r.gops),
	}));

	return {
		...BASE,
		height: 120,
		x: { type: "band", label: "N" },
		y: { axis: null },
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
		},
		marks: [
			Plot.cell(cells, { x: "n", fill: "kernel" }),
			Plot.text(cells, {
				x: "n",
				text: (d: { kernel: string; gops: number }) =>
					`${d.kernel}\n${d.gops.toFixed(0)}`,
				fill: "#0e1012",
				fontSize: 11,
			}),
		],
	};
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test && bun run typecheck
```

Expected: PASS — 20 pass, 0 fail; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/charts/overview.ts web/src/lib/charts/overview.test.ts
git commit -m "Add the overview charts"
```

---

### Task 7: Threading charts

**Files:**
- Create: `web/src/lib/charts/threading.ts`
- Create: `web/src/lib/charts/threading.test.ts`

**Interfaces:**
- Consumes: `ChartSpec`, `Ctx`, `Filters`, `BASE` (Task 5); `hasSingleThreadBaseline` (Task 3).
- Produces: `throughputVsThreads: ChartSpec`, `parallelEfficiency: ChartSpec`, `canShowScaling(rows: Row[]): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/charts/threading.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { makeCtx, type Filters } from "./types";
import { canShowScaling, parallelEfficiency, throughputVsThreads } from "./threading";

const f: Filters = { precision: "f16", n: 1024, kernel: "rayon-ikj", relative: false };

const rows: Row[] = [
	{ kernel: "rayon-ikj", precision: "f16", n: 1024, threads: 1, gops: 52.9, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f16", n: 1024, threads: 4, gops: 199.5, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f16", n: 1024, threads: 10, gops: 394.1, backend: "cpu" },
	{ kernel: "static-ikj", precision: "f16", n: 1024, threads: 1, gops: 52.8, backend: "cpu" },
	{ kernel: "static-ikj", precision: "f16", n: 1024, threads: 4, gops: 199.9, backend: "cpu" },
	{ kernel: "static-ikj", precision: "f16", n: 1024, threads: 10, gops: 304.8, backend: "cpu" },
	{ kernel: "ikj", precision: "f16", n: 1024, threads: 1, gops: 52.5, backend: "cpu" },
];

test("the scaling chart builds when a kernel has two thread counts", () => {
	expect(throughputVsThreads(rows, f, makeCtx(rows))).not.toBeNull();
});

test("serial-only rows are not a scaling chart", () => {
	const serial = rows.filter((r) => r.kernel === "ikj");
	expect(throughputVsThreads(serial, f, makeCtx(serial))).toBeNull();
});

test("the speedup projection needs a 1-thread row", () => {
	expect(canShowScaling(rows)).toBe(true);
	expect(canShowScaling(rows.filter((r) => r.threads !== 1))).toBe(false);
});

test("efficiency builds per size and caps the axis at 100", () => {
	const spec = parallelEfficiency(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	expect(spec?.y?.domain).toEqual([0, 100]);
});

test("efficiency without a 1-thread baseline is not shown", () => {
	const noBase = rows.filter((r) => r.threads !== 1);
	expect(parallelEfficiency(noBase, f, makeCtx(noBase))).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — module `./threading` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/lib/charts/threading.ts`:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { hasSingleThreadBaseline } from "../derive";
import { REFERENCE_INK } from "../palette";
import { BASE, type ChartSpec, type Ctx } from "./types";

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
	const mine = parallelRows(rows, ctx);
	const counts = new Set(mine.map((r) => Number(r.threads)));
	if (counts.size < 2) return null;

	const relative = f.relative && canShowScaling(mine);
	const base = singleThread(mine);
	const points = mine
		.map((r) => ({
			threads: Number(r.threads),
			kernel: String(r.kernel),
			y: relative
				? Number(r.gops) / (base.get(String(r.kernel)) ?? Number.NaN)
				: Number(r.gops),
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...counts].sort((a, b) => a - b);
	const ideal = ticks.map((t) => ({ threads: t, y: t }));

	return {
		...BASE,
		// Linear, not log: 8 and 10 really are close, and linear shows the
		// departure from ideal as curvature where log would straighten it.
		x: { type: "linear", ticks, label: "Threads" },
		y: {
			type: "linear",
			label: relative ? "× vs 1 thread" : "GOP/s",
			labelAnchor: "top",
		},
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
			legend: true,
		},
		marks: [
			...(relative
				? [
						Plot.line(ideal, {
							x: "threads",
							y: "y",
							stroke: REFERENCE_INK,
							strokeDasharray: "5 5",
						}),
					]
				: []),
			Plot.line(points, { x: "threads", y: "y", stroke: "kernel", strokeWidth: 2 }),
			Plot.dot(points, { x: "threads", y: "y", fill: "kernel", r: 4 }),
			Plot.text(
				points.filter((p) => p.threads === ticks[ticks.length - 1]),
				{
					x: "threads",
					y: "y",
					text: "kernel",
					dx: 6,
					textAnchor: "start",
					fill: "#9aa1a8",
					fontSize: 11,
				},
			),
			Plot.tip(
				points,
				Plot.pointer({
					x: "threads",
					y: "y",
					title: (d: { kernel: string; y: number }) =>
						`${d.kernel}\n${d.y.toFixed(1)}`,
				}),
			),
		],
	};
};

export const parallelEfficiency: ChartSpec = (rows, _f, ctx) => {
	const mine = parallelRows(rows, ctx);
	if (!canShowScaling(mine)) return null;

	// Baseline per (kernel, n) so efficiency compares like with like.
	const base = new Map<string, number>();
	for (const r of mine) {
		if (Number(r.threads) === 1) base.set(`${r.kernel}\u0000${r.n}`, Number(r.gops));
	}

	const points = mine
		.map((r) => ({
			threads: Number(r.threads),
			n: String(r.n),
			y:
				(Number(r.gops) / (base.get(`${r.kernel}\u0000${r.n}`) ?? Number.NaN) /
					Number(r.threads)) *
				100,
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...new Set(points.map((p) => p.threads))].sort((a, b) => a - b);
	if (ticks.length < 2) return null;

	return {
		...BASE,
		x: { type: "linear", ticks, label: "Threads" },
		y: { type: "linear", domain: [0, 100], label: "% of ideal", labelAnchor: "top" },
		// n is ordinal, so a sequential ramp — not the categorical kernel palette.
		color: { type: "ordinal", scheme: "YlGnBu", legend: true, label: "N" },
		marks: [
			Plot.line(points, { x: "threads", y: "y", stroke: "n", strokeWidth: 2 }),
			Plot.dot(points, { x: "threads", y: "y", fill: "n", r: 4 }),
			Plot.tip(
				points,
				Plot.pointer({
					x: "threads",
					y: "y",
					title: (d: { n: string; y: number }) => `N = ${d.n}\n${d.y.toFixed(0)}%`,
				}),
			),
		],
	};
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test && bun run typecheck
```

Expected: PASS — 25 pass, 0 fail; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/charts/threading.ts web/src/lib/charts/threading.test.ts
git commit -m "Add the thread scaling and parallel efficiency charts"
```

---

### Task 8: Precision and GPU charts

**Files:**
- Create: `web/src/lib/charts/precision.ts`
- Create: `web/src/lib/charts/gpu.ts`
- Create: `web/src/lib/charts/precision.test.ts`
- Create: `web/src/lib/charts/gpu.test.ts`

**Interfaces:**
- Consumes: `ChartSpec`, `Ctx`, `Filters`, `BASE`, `log2Ticks` (Task 5); `bestPerKernel` (Task 3).
- Produces: `throughputByPrecision: ChartSpec`; `gpuVsCpu: ChartSpec`, `gpuRatio: ChartSpec`, `hasGpu(rows: Row[]): boolean`.

- [ ] **Step 1: Write the failing precision test**

Create `web/src/lib/charts/precision.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { makeCtx, type Filters } from "./types";
import { throughputByPrecision } from "./precision";

const f: Filters = { precision: "f32", n: 64, kernel: "ikj", relative: false };

const rows: Row[] = [
	{ kernel: "ikj", precision: "f32", n: 64, threads: 1, gops: 30, backend: "cpu" },
	{ kernel: "ikj", precision: "i64", n: 64, threads: 1, gops: 6, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 64, threads: 4, gops: 90, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "i64", n: 64, threads: 4, gops: 20, backend: "cpu" },
];

test("the precision chart builds when two precisions exist at the size", () => {
	expect(throughputByPrecision(rows, f, makeCtx(rows))).not.toBeNull();
});

test("one precision is not a comparison", () => {
	const one = rows.filter((r) => r.precision === "f32");
	expect(throughputByPrecision(one, f, makeCtx(one))).toBeNull();
});

test("precisions are ordered by descending best throughput", () => {
	const spec = throughputByPrecision(rows, f, makeCtx(rows));
	expect(spec?.fx?.domain).toEqual(["f32", "i64"]);
});
```

- [ ] **Step 2: Write the failing GPU test**

Create `web/src/lib/charts/gpu.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { makeCtx, type Filters } from "./types";
import { gpuRatio, gpuVsCpu, hasGpu } from "./gpu";

const f: Filters = { precision: "f32", n: 512, kernel: "mps", relative: false };

const rows: Row[] = [
	{ kernel: "mps", precision: "f32", n: 256, threads: 1, gops: 93, backend: "metal" },
	{ kernel: "mps", precision: "f32", n: 512, threads: 1, gops: 738, backend: "metal" },
	{ kernel: "rayon-ikj", precision: "f32", n: 256, threads: 4, gops: 138, backend: "cpu" },
	{ kernel: "rayon-ikj", precision: "f32", n: 512, threads: 4, gops: 194, backend: "cpu" },
	{ kernel: "ikj", precision: "f32", n: 256, threads: 1, gops: 30, backend: "cpu" },
	{ kernel: "ikj", precision: "f32", n: 512, threads: 1, gops: 32, backend: "cpu" },
];

test("the GPU tab is present only with metal rows", () => {
	expect(hasGpu(rows)).toBe(true);
	expect(hasGpu(rows.filter((r) => r.backend !== "metal"))).toBe(false);
});

test("both GPU charts build from metal plus CPU rows", () => {
	const ctx = makeCtx(rows);
	expect(gpuVsCpu(rows, f, ctx)).not.toBeNull();
	expect(gpuRatio(rows, f, ctx)).not.toBeNull();
});

test("neither GPU chart builds without metal rows", () => {
	const cpu = rows.filter((r) => r.backend !== "metal");
	const ctx = makeCtx(cpu);
	expect(gpuVsCpu(cpu, f, ctx)).toBeNull();
	expect(gpuRatio(cpu, f, ctx)).toBeNull();
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
cd web && bun test
```

Expected: FAIL — modules `./precision` and `./gpu` do not exist.

- [ ] **Step 4: Implement the precision chart**

Create `web/src/lib/charts/precision.ts`:

```ts
import * as Plot from "@observablehq/plot";
import { BASE, type ChartSpec } from "./types";

/**
 * Grouped bars, one group per precision. The precision pill group is inert on
 * this tab: precision is the x-axis here, so filtering by it would leave one
 * bar. `f.n` still pins the size.
 */
export const throughputByPrecision: ChartSpec = (rows, f, ctx) => {
	const atSize = rows.filter(
		(r) => Number(r.n) === f.n && ctx.palette.has(String(r.kernel)),
	);

	// Best per (kernel, precision) at this size, for the same reason the size
	// chart uses best-per-kernel: pinning threads would drop serial kernels.
	const best = new Map<string, { precision: string; kernel: string; gops: number }>();
	for (const r of atSize) {
		const key = `${r.kernel}\u0000${r.precision}`;
		const current = best.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops) {
			best.set(key, { precision: String(r.precision), kernel: String(r.kernel), gops });
		}
	}
	const bars = [...best.values()];
	const order = [...new Set(bars.map((b) => b.precision))].sort(
		(a, b) =>
			Math.max(...bars.filter((x) => x.precision === b).map((x) => x.gops)) -
			Math.max(...bars.filter((x) => x.precision === a).map((x) => x.gops)),
	);
	if (order.length < 2) return null;

	return {
		...BASE,
		fx: { domain: order, label: "Precision" },
		x: { axis: null },
		y: { type: "linear", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
			legend: true,
		},
		marks: [
			// fx facets by precision and x separates the kernels inside each
			// facet: barY would stack them if both shared one x channel.
			Plot.barY(bars, {
				fx: "precision",
				x: "kernel",
				y: "gops",
				fill: "kernel",
				// 2px surface gap between adjacent bars.
				insetLeft: 1,
				insetRight: 1,
			}),
			Plot.tip(
				bars,
				Plot.pointer({
					x: "precision",
					y: "gops",
					title: (d: { kernel: string; gops: number }) =>
						`${d.kernel}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};
```

Note: `fx` is what produces grouped bars. Giving `barY` a single `x` channel
shared with `fill` stacks the series instead, which would misread as a total.

- [ ] **Step 5: Implement the GPU charts**

Create `web/src/lib/charts/gpu.ts`:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { bestPerKernel } from "../derive";
import { REFERENCE_INK } from "../palette";
import { BASE, type ChartSpec, type Ctx, log2Ticks } from "./types";

export function hasGpu(rows: Row[]): boolean {
	return rows.some((r) => r.backend === "metal");
}

/** Best gpu / parallel / serial result at each size — one line per family. */
function byFamily(rows: Row[], ctx: Ctx) {
	const out = new Map<string, { n: number; family: string; gops: number }>();
	for (const r of bestPerKernel(rows)) {
		const family = ctx.family.get(String(r.kernel)) ?? "serial";
		const key = `${family}\u0000${r.n}`;
		const current = out.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops) out.set(key, { n: Number(r.n), family, gops });
	}
	return [...out.values()];
}

const FAMILY_INK = {
	gpu: "#e66767",
	parallel: "#c98500",
	serial: "#199e70",
} as const;

export const gpuVsCpu: ChartSpec = (rows, _f, ctx) => {
	if (!hasGpu(rows)) return null;
	const points = byFamily(rows, ctx);
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	return {
		...BASE,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: Object.keys(FAMILY_INK),
			range: Object.values(FAMILY_INK),
			legend: true,
		},
		marks: [
			Plot.line(points, {
				x: "n",
				y: "gops",
				stroke: "family",
				strokeWidth: 2,
				// Dashed because the mps timed region is commit -> waitUntilCompleted
				// only: buffer copies and encoding are excluded.
				strokeDasharray: (d: { family: string }) =>
					d.family === "gpu" ? "5 4" : undefined,
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "family", r: 4 }),
			// Three series, so direct labels as well as the legend.
			Plot.text(
				points.filter((p) => p.n === sizes[sizes.length - 1]),
				{
					x: "n",
					y: "gops",
					text: "family",
					dx: 6,
					textAnchor: "start",
					fill: "#9aa1a8",
					fontSize: 11,
				},
			),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "gops",
					title: (d: { family: string; gops: number }) =>
						`${d.family}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

export const gpuRatio: ChartSpec = (rows, _f, ctx) => {
	if (!hasGpu(rows)) return null;
	const points = byFamily(rows, ctx);
	const gpu = new Map(points.filter((p) => p.family === "gpu").map((p) => [p.n, p.gops]));
	const cpu = new Map(
		points.filter((p) => p.family === "parallel").map((p) => [p.n, p.gops]),
	);

	const ratios = [...gpu.entries()]
		.map(([n, g]) => ({ n, ratio: g / (cpu.get(n) ?? Number.NaN) }))
		.filter((p) => Number.isFinite(p.ratio))
		.sort((a, b) => a.n - b.n);
	if (ratios.length < 2) return null;

	const sizes = log2Ticks(ratios.map((p) => p.n));
	return {
		...BASE,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "mps ÷ best CPU", labelAnchor: "top" },
		marks: [
			Plot.ruleY([1], { stroke: REFERENCE_INK, strokeDasharray: "5 5" }),
			Plot.line(ratios, { x: "n", y: "ratio", stroke: "#e66767", strokeWidth: 2 }),
			Plot.dot(ratios, { x: "n", y: "ratio", fill: "#e66767", r: 4 }),
			Plot.tip(
				ratios,
				Plot.pointer({
					x: "n",
					y: "ratio",
					title: (d: { ratio: number }) => `${d.ratio.toFixed(2)}×`,
				}),
			),
		],
	};
};
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd web && bun test && bun run typecheck
```

Expected: PASS — 33 pass, 0 fail; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/charts/precision.ts web/src/lib/charts/gpu.ts web/src/lib/charts/precision.test.ts web/src/lib/charts/gpu.test.ts
git commit -m "Add the precision comparison and GPU charts"
```

---

### Task 9: Tab registry

Which charts live on which tab, which controls each tab declares, and which tabs exist at all for a given dataset.

**Files:**
- Create: `web/src/lib/charts/index.ts`
- Create: `web/src/lib/charts/index.test.ts`

**Interfaces:**
- Consumes: every chart from Tasks 6-8; `Ctx`, `Filters` (Task 5).
- Produces:
  - `type Control = "precision" | "n" | "kernel"`
  - `interface Panel { title: string; note: string; spec: ChartSpec }`
  - `interface Tab { id: string; label: string; controls: Control[]; panels: Panel[]; inertPrecision?: boolean }`
  - `TABS: Tab[]`
  - `visibleTabs(rows: Row[], f: Filters, ctx: Ctx): Tab[]`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/charts/index.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { TABS, visibleTabs } from "./index";
import { makeCtx, type Filters } from "./types";

const f: Filters = { precision: "f32", n: 512, kernel: "rayon-ikj", relative: false };

const cpuOnly: Row[] = [
	{ kernel: "naive-ijk", precision: "f32", n: 256, threads: 1, gops: 2, backend: "cpu", median_ms: 1, stddev_ms: 0 },
	{ kernel: "naive-ijk", precision: "f32", n: 512, threads: 1, gops: 3, backend: "cpu", median_ms: 1, stddev_ms: 0 },
	{ kernel: "rayon-ikj", precision: "f32", n: 256, threads: 1, gops: 10, backend: "cpu", median_ms: 1, stddev_ms: 0 },
	{ kernel: "rayon-ikj", precision: "f32", n: 512, threads: 4, gops: 90, backend: "cpu", median_ms: 1, stddev_ms: 0 },
];

test("every tab declares its own controls", () => {
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview?.controls).toEqual(["precision"]);
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.inertPrecision).toBe(true);
});

test("the GPU tab is absent without metal rows", () => {
	const ids = visibleTabs(cpuOnly, f, makeCtx(cpuOnly)).map((t) => t.id);
	expect(ids).toContain("overview");
	expect(ids).not.toContain("gpu");
});

test("no rows, no tabs", () => {
	expect(visibleTabs([], f, makeCtx([]))).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && bun test
```

Expected: FAIL — module `./index` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/lib/charts/index.ts`:

```ts
import type { Row } from "../db";
import { gpuRatio, gpuVsCpu } from "./gpu";
import { fastestPerSize, serialOnly, throughputVsSize } from "./overview";
import { throughputByPrecision } from "./precision";
import { parallelEfficiency, throughputVsThreads } from "./threading";
import type { ChartSpec, Ctx, Filters } from "./types";

export type Control = "precision" | "n" | "kernel";

export interface Panel {
	title: string;
	note: string;
	spec: ChartSpec;
}

export interface Tab {
	id: string;
	label: string;
	controls: Control[];
	panels: Panel[];
	/** The precision pills render disabled: precision is this tab's x-axis. */
	inertPrecision?: boolean;
}

export const TABS: Tab[] = [
	{
		id: "overview",
		label: "Overview",
		controls: ["precision"],
		panels: [
			{
				title: "Throughput vs matrix size",
				note: "Each kernel at its best thread count · log–log · band is ±1 stddev",
				spec: throughputVsSize,
			},
			{
				title: "Fastest kernel per size",
				note: "Computed over every kernel, independent of the legend above",
				spec: fastestPerSize,
			},
			{
				title: "Single-threaded kernels",
				note: "Loop order and cache blocking, rescaled away from the parallel kernels",
				spec: serialOnly,
			},
		],
	},
	{
		id: "threads",
		label: "CPU threading",
		controls: ["precision", "n"],
		panels: [
			{
				title: "Throughput vs thread count",
				note: "Linear axes · work-stealing vs fixed partitioning",
				spec: throughputVsThreads,
			},
			{
				title: "Parallel efficiency",
				note: "Speedup as a share of ideal, per matrix size",
				spec: parallelEfficiency,
			},
		],
	},
	{
		id: "precision",
		label: "Precision",
		controls: ["n"],
		inertPrecision: true,
		panels: [
			{
				title: "Throughput by precision",
				note: "Each kernel at its best thread count, at the selected size",
				spec: throughputByPrecision,
			},
		],
	},
	{
		id: "gpu",
		label: "GPU",
		controls: ["precision"],
		panels: [
			{
				title: "GPU vs CPU",
				note: "mps is dashed: its timed region excludes buffer copies and encoding",
				spec: gpuVsCpu,
			},
			{
				title: "GPU ÷ best CPU",
				note: "Crosses 1.0 where the GPU starts winning",
				spec: gpuRatio,
			},
		],
	},
];

/** A tab is present iff at least one of its panels can be built. */
export function visibleTabs(rows: Row[], f: Filters, ctx: Ctx): Tab[] {
	return TABS.filter((t) => t.panels.some((p) => p.spec(rows, f, ctx) !== null));
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && bun test && bun run typecheck
```

Expected: PASS — 36 pass, 0 fail; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/charts/index.ts web/src/lib/charts/index.test.ts
git commit -m "Add the tab registry and its visibility guard"
```

---

### Task 10: App shell, table view, and browser verification

Replaces the single-slice table with the tabbed shell, keeping the table as each tab's data view.

**Files:**
- Create: `web/src/lib/state.svelte.ts`
- Modify: `web/src/App.svelte` (full rewrite)
- Modify: `web/src/app.css`
- Modify: `web/index.html` (fonts, title)

**Interfaces:**
- Consumes: `query` (`./lib/db`), everything from Tasks 2-9.
- Produces: the running dashboard.

- [ ] **Step 1: Create the reactive store**

The filename must end `.svelte.ts` — Svelte 5 does not compile runes in a plain `.ts` file.

Create `web/src/lib/state.svelte.ts`:

```ts
import { type Row, query } from "./db";
import { defaultPrecision, defaultSize } from "./derive";

export const store = $state({
	rows: [] as Row[],
	error: "",
	loaded: false,
	precision: "",
	n: 0,
	kernel: "",
	relative: false,
	tab: "overview",
});

/** One query at boot; every derivation downstream is synchronous. */
export async function boot(): Promise<void> {
	try {
		const rows = await query("SELECT * FROM results");
		store.rows = rows;
		store.precision = defaultPrecision(rows);
		store.n = defaultSize(rows, store.precision);
		store.loaded = true;
	} catch (e) {
		store.error = String(e);
	}
}
```

- [ ] **Step 2: Rewrite the app shell**

Replace `web/src/App.svelte` entirely:

```svelte
<script lang="ts">
import Chart from "./lib/Chart.svelte";
import { TABS, visibleTabs } from "./lib/charts/index";
import { makeCtx } from "./lib/charts/types";
import { allSizes, defaultSize, kernels, sizesFor } from "./lib/derive";
import { boot, store } from "./lib/state.svelte";

boot();

const ctx = $derived(makeCtx(store.rows));
const filters = $derived({
	precision: store.precision,
	n: store.n,
	kernel: store.kernel,
	relative: store.relative,
});
const tabs = $derived(visibleTabs(store.rows, filters, ctx));
const tab = $derived(tabs.find((t) => t.id === store.tab) ?? tabs[0]);
const scoped = $derived(
	tab?.inertPrecision
		? store.rows
		: store.rows.filter((r) => r.precision === store.precision),
);
const available = $derived(sizesFor(store.rows, store.precision));
const kernelList = $derived(kernels(scoped));

function pickPrecision(p: string) {
	store.precision = p;
	if (!sizesFor(store.rows, p).includes(store.n)) {
		store.n = defaultSize(store.rows, p);
	}
}
</script>

<main>
	<header>
		<h1>gemm-bench</h1>
		<p>C = A·B on square N×N matrices · throughput = 2N³ / median wall time</p>
	</header>

	{#if store.error}
		<p class="error">{store.error}</p>
	{:else if !store.loaded}
		<p class="muted">Loading DuckDB…</p>
	{:else if !tab}
		<p class="muted">No results yet. Run <code>just bench</code> and <code>just data</code>.</p>
	{:else}
		<nav>
			{#each tabs as t}
				<button
					type="button"
					class:current={t.id === tab.id}
					onclick={() => (store.tab = t.id)}>{t.label}</button>
			{/each}
		</nav>

		<div class="controls">
			{#if tab.controls.includes("precision") || tab.inertPrecision}
				<div class="group" role="group" aria-label="Precision">
					{#each [...new Set(store.rows.map((r) => String(r.precision)))].sort() as p}
						<button
							type="button"
							disabled={tab.inertPrecision}
							title={tab.inertPrecision ? "Precision is this chart's x-axis" : ""}
							aria-pressed={p === store.precision}
							class:on={p === store.precision}
							onclick={() => pickPrecision(p)}>{p}</button>
					{/each}
				</div>
			{/if}

			{#if tab.controls.includes("n")}
				<div class="group" role="group" aria-label="Matrix size">
					{#each allSizes(store.rows) as s}
						<button
							type="button"
							disabled={!available.includes(s)}
							title={available.includes(s)
								? ""
								: `no ${store.precision} runs at N = ${s}`}
							aria-pressed={s === store.n}
							class:on={s === store.n}
							onclick={() => (store.n = s)}>N = {s}</button>
					{/each}
				</div>
			{/if}

			{#if tab.controls.includes("kernel")}
				<div class="group" role="group" aria-label="Kernel">
					{#each kernelList as k}
						<button
							type="button"
							aria-pressed={k === store.kernel}
							class:on={k === store.kernel}
							onclick={() => (store.kernel = k)}>{k}</button>
					{/each}
				</div>
			{/if}

			<label class="toggle">
				<input type="checkbox" bind:checked={store.relative} />
				Relative
			</label>
		</div>

		<div class="panels">
			{#each tab.panels as panel}
				<Chart
					title={panel.title}
					note={panel.note}
					spec={panel.spec(scoped, filters, ctx)} />
			{/each}
		</div>

		<details class="table">
			<summary>Data view ({scoped.length} rows)</summary>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							{#each scoped.length ? Object.keys(scoped[0]) : [] as c}<th>{c}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each scoped as row}
							<tr>
								{#each Object.keys(scoped[0]) as c}
									<td>
										{typeof row[c] === "number" && !Number.isInteger(row[c])
											? (row[c] as number).toFixed(3)
											: row[c]}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</main>

<style>
	main {
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	h1 {
		margin: 0;
		font-family: "IBM Plex Mono", monospace;
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.5px;
	}
	header p,
	.muted {
		margin: 6px 0 0;
		font-size: 14px;
		color: #9aa1a8;
	}
	.error {
		color: #e66767;
	}
	nav {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid #24292e;
	}
	nav button {
		min-height: 44px;
		padding: 0 18px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		font-size: 14px;
		font-weight: 500;
		color: #9aa1a8;
		cursor: pointer;
	}
	nav button.current {
		color: #e6e3dc;
		border-bottom-color: #e8743b;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
	}
	.group {
		display: flex;
		gap: 6px;
		padding: 3px;
		background: #15181b;
		border: 1px solid #24292e;
		border-radius: 8px;
	}
	.group button {
		min-height: 36px;
		padding: 0 14px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #9aa1a8;
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
		cursor: pointer;
	}
	.group button.on {
		background: #e6e3dc;
		color: #0e1012;
	}
	.group button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.toggle {
		font-size: 13px;
		color: #9aa1a8;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.panels {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.table summary {
		cursor: pointer;
		color: #9aa1a8;
		font-size: 13px;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 12px;
	}
	table {
		border-collapse: collapse;
		font-family: "IBM Plex Mono", monospace;
		font-size: 12px;
	}
	th,
	td {
		padding: 6px 12px;
		text-align: right;
		border-bottom: 1px solid #24292e;
		white-space: nowrap;
	}
	th {
		color: #9aa1a8;
		font-weight: 500;
	}
</style>
```

- [ ] **Step 3: Set the global theme**

Replace `web/src/app.css`:

```css
:root {
	color-scheme: dark;
	font-family: "IBM Plex Sans", system-ui, sans-serif;
}

body {
	margin: 0;
	background: #0e1012;
	color: #e6e3dc;
}

button:focus-visible {
	outline: 2px solid #e8743b;
	outline-offset: 2px;
}
```

- [ ] **Step 4: Load the fonts**

In `web/index.html`, add inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
```

and set `<title>gemm-bench</title>`.

- [ ] **Step 5: Run the full gate**

```bash
just data && just test && just check
```

Expected: parquet rebuilt, 36 web tests pass, Rust tests pass, clippy and tsc clean.

- [ ] **Step 6: Verify in the browser**

Start the preview (`preview_start` with name `dashboard`), then for each of the four tabs:

1. Read the console — expect zero errors.
2. Confirm the panel renders a plot rather than the empty state.
3. On the Overview tab, select `f32` and confirm the N pills for 2048 and 4096 are **disabled** with the title "no f32 runs at N = 2048", then select `i32` and confirm they become enabled.
4. On the Precision tab, confirm the precision pills are disabled.
5. Toggle **Relative** on Overview and Threading and confirm the y-axis label changes to "× vs naive-ijk" and "× vs 1 thread".
6. Screenshot each tab.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.svelte web/src/app.css web/src/lib/state.svelte.ts web/index.html
git commit -m "Replace the results table with the tabbed dashboard"
```

---

## Notes for the executor

- **`bun test` runs from `web/`.** `cd web && bun test`, or `just test-web` from the repo root.
- **Lefthook runs on every commit** (fmt, clippy, Rust tests, Biome, typecheck, data-build). Do not bypass it. After Task 1 it also runs `bun test`.
- **If a Plot API call does not typecheck**, check the installed version first — this plan targets `@observablehq/plot@0.6.17`. Do not work around a type error by casting to `any`; find the correct channel name.
- **Never edit anything under `data/runs/`.** If a chart looks wrong, the fix is in `web/`, not the data.

import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import peaksCsv from "../../../../data/peaks.csv?raw";
import { openDb, type Row, readMachine, readRows } from "../data/db";
import { partitionPlottable } from "../model/rows";
import { parsePeaks } from "../peaks/parse";
import { initialFilters, precisionsForTab } from "../state/filters";
import { pointsOf, row } from "../test/fixtures";
import { type FixtureMeasurement, fixtureDb, SQL } from "../test/testdb";
import { gpuKernels } from "./gpu";
import { rowsForTab } from "./scope";
import { type Ctx, type Filters, makeCtx } from "./spec";
import { TABS } from "./tabs";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "rayon-ikj",
	knobs: {},
	relative: false,
};

const cpuOnly: Row[] = [
	row({
		kernel: "naive-ijk",
		n: 256,
		gops: 2,
		median_ms: 1,
		stddev_ms: 0,
	}),
	row({
		kernel: "naive-ijk",
		n: 512,
		gops: 3,
		median_ms: 1,
		stddev_ms: 0,
	}),
	row({
		kernel: "rayon-ikj",
		n: 256,
		gops: 10,
		median_ms: 1,
		stddev_ms: 0,
	}),
	row({
		kernel: "rayon-ikj",
		n: 512,
		threads: 4,
		gops: 90,
		median_ms: 1,
		stddev_ms: 0,
	}),
];

test("every tab declares its own controls", () => {
	const tab = (id: string) => TABS.find((t) => t.id === id);
	expect(TABS.map((t) => t.id)).toEqual([
		"overview",
		"cpu",
		"threads",
		"precision",
		"gpu",
		"knobs",
	]);
	expect(tab("overview")?.controls).toEqual(["precision"]);
	expect(tab("overview")?.inertKnobs).toBe(true);
	expect(tab("cpu")?.controls).toEqual(["precision", "knobs"]);
	expect(tab("precision")?.inertPrecision).toBe(true);
	expect(tab("knobs")?.inertKnobs).toBe(true);
});

test("without metal rows the GPU tab charts nothing", () => {
	const ctx = makeCtx(cpuOnly);
	expect(precisionsForTab(tabById("overview"), cpuOnly, f, ctx)).toEqual([
		"f32",
	]);
	expect(precisionsForTab(tabById("gpu"), cpuOnly, f, ctx)).toEqual([]);
});

test("no rows, nothing to chart on any tab", () => {
	for (const t of TABS)
		expect(precisionsForTab(t, [], f, makeCtx([]))).toEqual([]);
});

test("the GPU tab charts only the precisions the GPU ran", () => {
	const withGpu: Row[] = [
		...cpuOnly,
		row({
			kernel: "mps",
			n: 256,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "mps",
			n: 512,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "rayon-ikj",
			precision: "f64",
			n: 256,
			threads: 4,
			gops: 40,
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "rayon-ikj",
			precision: "f64",
			n: 512,
			threads: 4,
			gops: 70,
			median_ms: 1,
			stddev_ms: 0,
		}),
	];
	const ctx = makeCtx(withGpu);
	expect(precisionsForTab(tabById("gpu"), withGpu, f, ctx)).toEqual(["f32"]);
	expect(precisionsForTab(tabById("overview"), withGpu, f, ctx)).toEqual([
		"f32",
		"f64",
	]);
});

/** The tabs that chart something at the selected precision. */
function charting(rows: Row[], f: Filters, ctx: Ctx) {
	return TABS.filter((t) =>
		precisionsForTab(t, rows, f, ctx).includes(f.precision),
	);
}

/** A tab by id, failing the test if it's gone. */
function tabById(id: string) {
	const found = TABS.find((t) => t.id === id);
	if (!found) throw new Error(`no ${id} tab`);
	return found;
}

test("a non-selected tile size does not leak into a pinned chart", () => {
	// If rowsForTab stopped scoping by knob, the outlier at tile 64 would
	// survive into a chart pinned to tile 32.
	const twoTiles: Row[] = [
		row({
			kernel: "tiled",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "tiled",
			n: 512,
			gops: 11,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "tiled",
			n: 256,
			gops: 9999,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 64 },
		}),
	];
	const scoped = rowsForTab(
		tabById("cpu"),
		twoTiles,
		"f32",
		{ tile_size: 32 },
		makeCtx(twoTiles),
	);
	expect(scoped.map((r) => r.swept.tile_size)).toEqual([32, 32]);
});

test("each knob pins only the kernels that sweep it", () => {
	const both: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 256, gops: 12, swept: { tile_size: 64 } }),
		row({ kernel: "packed", n: 256, gops: 30, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 256, gops: 35, swept: { depth_block: 512 } }),
	];
	const scoped = rowsForTab(
		tabById("cpu"),
		both,
		"f32",
		{ tile_size: 64, depth_block: 256 },
		makeCtx(both),
	);
	expect(scoped.map((r) => r.gops)).toEqual([12, 30]);
});

test("the Tuning knobs tab is absent with one value per knob, present with two", () => {
	const one: Row[] = [
		row({
			kernel: "tiled",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "packed",
			n: 256,
			gops: 20,
			median_ms: 1,
			stddev_ms: 0,
			swept: { depth_block: 256 },
		}),
	];
	const ids = (rows: Row[]) =>
		charting(
			rows,
			{
				...f,
				precision: "f32",
				n: 256,
				knobs: { tile_size: 32, depth_block: 256 },
			},
			makeCtx(rows),
		).map((t) => t.id);
	expect(ids(one)).not.toContain("knobs");
	const two = [
		...one,
		row({
			kernel: "tiled",
			n: 256,
			gops: 12,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 64 },
		}),
	];
	expect(ids(two)).toContain("knobs");
});

test("the GPU tab ignores knob pins: it is a family view", () => {
	const rows: Row[] = [
		row({
			kernel: "mps",
			n: 256,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "mps",
			n: 512,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "rayon-tiled",
			n: 256,
			threads: 4,
			gops: 40,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "rayon-tiled",
			n: 512,
			threads: 4,
			gops: 70,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
	];
	const ids = charting(
		rows,
		{ ...f, precision: "f32", knobs: { tile_size: 64 } },
		makeCtx(rows),
	).map((t) => t.id);
	expect(ids).toContain("gpu");
});

test("the GPU tab's CPU reference is the family's best tile size", () => {
	// rayon-tiled is faster at tile 64, the non-selected one; the GPU tab is a
	// family view, so its parallel reference is the family's best configuration.
	const rows: Row[] = [
		row({ kernel: "mps", n: 256, gops: 93, backend: "metal" }),
		row({ kernel: "mps", n: 512, gops: 738, backend: "metal" }),
		row({
			kernel: "rayon-tiled",
			n: 256,
			threads: 4,
			gops: 40,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "rayon-tiled",
			n: 512,
			threads: 4,
			gops: 45,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "rayon-tiled",
			n: 256,
			threads: 4,
			gops: 60,
			swept: { tile_size: 64 },
		}),
		row({
			kernel: "rayon-tiled",
			n: 512,
			threads: 4,
			gops: 70,
			swept: { tile_size: 64 },
		}),
	];
	const gpu = tabById("gpu");
	expect(gpu.inertKnobs).toBe(true);
	const ctx = makeCtx(rows);
	const scoped = rowsForTab(gpu, rows, "f32", { tile_size: 32 }, ctx);
	const spec = gpuKernels(scoped, { ...f, knobs: { tile_size: 32 } }, ctx);
	expect(pointsOf(spec, "parallel CPU").find((p) => p.x === 256)?.y).toBe(60);
});

test("rows without knobs, and a kernel measured at one value, survive any pin", () => {
	const mixed: Row[] = [
		row({
			kernel: "ikj",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "ikj",
			n: 512,
			gops: 11,
			median_ms: 1,
			stddev_ms: 0,
		}),
		row({
			kernel: "tiled",
			n: 256,
			gops: 12,
			median_ms: 1,
			stddev_ms: 0,
			swept: { tile_size: 32 },
		}),
	];
	const scoped = rowsForTab(
		tabById("cpu"),
		mixed,
		"f32",
		{ tile_size: 64 },
		makeCtx(mixed),
	);
	expect(scoped.map((r) => r.gops)).toEqual([10, 11, 12]);
});

test("the Overview is a family view: it keeps every knob value", () => {
	const rows: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 512, gops: 11, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 256, gops: 20, swept: { tile_size: 64 } }),
	];
	expect(
		rowsForTab(
			tabById("overview"),
			rows,
			"f32",
			{ tile_size: 32 },
			makeCtx(rows),
		),
	).toHaveLength(3);
});

test("the Precision tab is a family view pinned only by size", () => {
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.controls).toEqual(["n"]);
	expect(precision?.inertKnobs).toBe(true);
});

test("panel titles are unique across all tabs", () => {
	// App.svelte keys the panel loop by title and Chart.svelte uses it as
	// legend.uirevision, so two panels sharing a title would cross-pollinate
	// each other's Svelte keying and Plotly zoom/legend state.
	const titles = TABS.flatMap((t) => t.panels.map((p) => p.title));
	expect(new Set(titles).size).toBe(titles.length);
});

const panels = TABS.flatMap((t) => t.panels);

const DOCS = new URL("../../docs/charts/", import.meta.url);

/** A panel's doc file: its title in kebab case, "÷" read as "vs". */
const docFile = (title: string) =>
	`${title
		.replace("÷", "vs")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")}.md`;

test("every panel shows the doc file named after its title", async () => {
	for (const p of panels) {
		expect(p.doc.trim()).not.toBe("");
		expect(p.doc).toBe(await Bun.file(new URL(docFile(p.title), DOCS)).text());
	}
});

test("every chart doc belongs to a panel", () => {
	const files = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
	expect(files.sort()).toEqual(panels.map((p) => docFile(p.title)).sort());
});

test("every caption fits on one line", () => {
	for (const p of panels) expect(p.note.length).toBeLessThanOrEqual(120);
});

test("no tab shadows the About tab", () => {
	// App.svelte opens the About tab on store.tab === "about".
	expect(TABS.map((t) => t.id)).not.toContain("about");
});

test("a host DB read through the views draws every panel", () => {
	// Every cell at both sizes, as a sweep records it.
	const at = (m: Omit<FixtureMeasurement, "n">): FixtureMeasurement[] =>
		[256, 512].map((n) => ({ ...m, n }));
	const packed = (kc: number, gops: number) =>
		at({
			kernel: "packed",
			gops,
			params: [
				["depth_block", kc, "swept"],
				["depth_block_used", kc, "derived"],
				["register_cols", 12, "derived"],
				["register_rows", 8, "fixed"],
				["register_col_vectors", 3, "fixed"],
			],
		});
	const db = openDb(
		SQL,
		fixtureDb([
			{
				started_at: "2026-10-01T00:00:00Z",
				tiers: [[0, "Performance", 8, 8]],
				caches: [[0, 2, "unified", 12 << 20, 4, 2]],
				measurements: [
					...at({ kernel: "naive-ijk", gops: 1 }),
					...at({ kernel: "ikj", gops: 10 }),
					...at({ kernel: "ikj", precision: "f64", gops: 5 }),
					...at({
						kernel: "tiled",
						gops: 12,
						params: [["tile_size", 32, "swept"]],
					}),
					...at({
						kernel: "tiled",
						gops: 14,
						params: [["tile_size", 64, "swept"]],
					}),
					...packed(256, 40),
					...packed(512, 45),
					...at({ kernel: "rayon-ikj", gops: 10 }),
					...at({ kernel: "rayon-ikj", threads: 8, gops: 60 }),
					...at({ kernel: "accelerate-blas", backend: "matrix", gops: 600 }),
					...at({ kernel: "mps", backend: "metal", gops: 900 }),
					...at({
						kernel: "mps",
						backend: "metal",
						precision: "f16",
						gops: 1500,
					}),
				],
			},
			{
				started_at: "2026-10-02T00:00:00Z",
				tiers: [[0, "Performance", 8, 8]],
				measurements: at({ kernel: "ikj", gops: 11 }),
			},
		]),
	);
	// The app's own path: state/store.svelte.ts, then App.svelte.
	const { rows } = partitionPlottable(readRows(db));
	expect(readMachine(db)?.tiers).toHaveLength(1);
	db.close();
	// The filters boot() lands on.
	const f = initialFilters(rows);
	const ctx = makeCtx(rows, parsePeaks(peaksCsv));

	const blank = TABS.flatMap((tab) => {
		const scoped = rowsForTab(tab, rows, f.precision, f.knobs, ctx);
		return tab.panels
			.filter((p) => !p.spec(scoped, f, ctx)?.data.some((t) => t.x?.length))
			.map((p) => p.title);
	});
	expect(blank).toEqual([]);
});

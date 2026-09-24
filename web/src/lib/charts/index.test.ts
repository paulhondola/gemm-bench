import { expect, test } from "bun:test";
import type { Row } from "../db";
import { row } from "../fixtures";
import { gpuVsCpu } from "./gpu";
import { rowsForTab, TABS, visibleTabs } from "./index";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "rayon-ikj",
	blockSize: 32,
	relative: false,
};

const cpuOnly: Row[] = [
	row({
		kernel: "naive-ijk",
		n: 256,
		gops: 2,
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	}),
	row({
		kernel: "naive-ijk",
		n: 512,
		gops: 3,
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	}),
	row({
		kernel: "rayon-ikj",
		n: 256,
		gops: 10,
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	}),
	row({
		kernel: "rayon-ikj",
		n: 512,
		threads: 4,
		gops: 90,
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	}),
];

test("every tab declares its own controls", () => {
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview?.controls).toEqual(["precision", "blockSize"]);
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.inertPrecision).toBe(true);
	const gpu = TABS.find((t) => t.id === "gpu");
	expect(gpu?.inertBlockSize).toBeUndefined();
	const blocksize = TABS.find((t) => t.id === "blocksize");
	expect(blocksize?.inertBlockSize).toBe(true);
});

test("the GPU tab is absent without metal rows", () => {
	const ids = visibleTabs(cpuOnly, f, makeCtx(cpuOnly)).map((t) => t.id);
	expect(ids).toContain("overview");
	expect(ids).not.toContain("gpu");
});

test("no rows, no tabs", () => {
	expect(visibleTabs([], f, makeCtx([]))).toEqual([]);
});

test("the GPU tab is absent for a precision the GPU never ran", () => {
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
	expect(
		visibleTabs(withGpu, { ...f, precision: "f32" }, ctx).map((t) => t.id),
	).toContain("gpu");
	expect(
		visibleTabs(withGpu, { ...f, precision: "f64" }, ctx).map((t) => t.id),
	).not.toContain("gpu");
});

test("a non-selected block size does not leak into a pinned chart", () => {
	// If rowsForTab stopped scoping by block size, the huge outlier at
	// block_size=64 would survive into a chart pinned to block_size=32.
	const twoBlockSizes: Row[] = [
		row({
			kernel: "ikj",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "ikj",
			n: 512,
			gops: 11,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "ikj",
			n: 256,
			gops: 9999,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
	];
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview).toBeDefined();
	if (!overview) return;
	const scoped = rowsForTab(
		overview,
		twoBlockSizes,
		"f32",
		32,
		makeCtx(twoBlockSizes),
	);
	expect(scoped.every((r) => r.block_size === 32)).toBe(true);
	expect(scoped).toHaveLength(2);
});

test("the Block size tab is absent with one block size, present with two", () => {
	const oneBlockSize: Row[] = [
		row({
			kernel: "ikj",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "tiled",
			n: 256,
			gops: 20,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
	];
	expect(
		visibleTabs(
			oneBlockSize,
			{ ...f, precision: "f32", n: 256, blockSize: 32 },
			makeCtx(oneBlockSize),
		).map((t) => t.id),
	).not.toContain("blocksize");

	const twoBlockSizes: Row[] = [
		...oneBlockSize,
		row({
			kernel: "ikj",
			n: 256,
			gops: 12,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
	];
	expect(
		visibleTabs(
			twoBlockSizes,
			{ ...f, precision: "f32", n: 256, blockSize: 32 },
			makeCtx(twoBlockSizes),
		).map((t) => t.id),
	).toContain("blocksize");
});

test("the GPU tab survives selecting a block size mps does not have", () => {
	// mps only has block_size=64 rows here. If GPU stopped being inert to
	// block size, filtering to blockSize=32 would drop every mps row and the
	// tab would vanish — a dead knob for a dimension that doesn't apply.
	const withGpu2: Row[] = [
		row({
			kernel: "mps",
			n: 256,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
		row({
			kernel: "mps",
			n: 512,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
		row({
			kernel: "rayon-ikj",
			n: 256,
			threads: 4,
			gops: 40,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "rayon-ikj",
			n: 512,
			threads: 4,
			gops: 70,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
	];
	const ctx = makeCtx(withGpu2);
	const ids = visibleTabs(
		withGpu2,
		{ ...f, precision: "f32", blockSize: 32 },
		ctx,
	).map((t) => t.id);
	expect(ids).toContain("gpu");
});

test("the GPU tab's CPU-family line pins to the selected block size, not the max across both", () => {
	// rayon-ikj is faster at block_size=64 (the non-selected one). mps has a
	// single block size (32) and must survive scoping regardless; rayon-ikj
	// has two, so it must be filtered to the selection. If the GPU tab stayed
	// inertBlockSize (never scoped), byFamily's bestPerKernel would see both
	// of rayon-ikj's block sizes and plot the higher one — the max-of-repeats
	// upward bias this feature exists to remove.
	const rows: Row[] = [
		row({
			kernel: "mps",
			n: 256,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "mps",
			n: 512,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "rayon-ikj",
			n: 256,
			threads: 4,
			gops: 40,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "rayon-ikj",
			n: 512,
			threads: 4,
			gops: 45,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
		row({
			kernel: "rayon-ikj",
			n: 256,
			threads: 4,
			gops: 999,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
		row({
			kernel: "rayon-ikj",
			n: 512,
			threads: 4,
			gops: 999,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
	];
	const gpu = TABS.find((t) => t.id === "gpu");
	expect(gpu).toBeDefined();
	if (!gpu) return;
	const ctx = makeCtx(rows);
	const scoped = rowsForTab(gpu, rows, "f32", 32, ctx);
	const spec = gpuVsCpu(scoped, { ...f, precision: "f32", blockSize: 32 }, ctx);
	expect(spec).not.toBeNull();
	if (!spec) return;
	const line = spec.marks[0] as {
		data: { family: string; n: number; gops: number | null }[];
	};
	const parallel = line.data.find(
		(d) => d.family === "parallel" && d.n === 256,
	);
	expect(parallel?.gops).toBe(40);
});

test("a row without a block size survives any block-size selection", () => {
	// Old runs recorded block_size=64 for every kernel; new ones leave it empty
	// for kernels that don't tile. ikj doesn't tile, so its only real block
	// size is the old 64 (the null row is skipped when collecting sizes) —
	// singleBlockSizeKernels exempts it, so both its rows survive a selection
	// pinned to block_size=32, alongside tiled's real block_size=32 row.
	const mixed: Row[] = [
		row({
			kernel: "ikj",
			n: 256,
			gops: 10,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		}),
		row({
			kernel: "ikj",
			n: 256,
			gops: 11,
			median_ms: 1,
			stddev_ms: 0,
			block_size: null,
		}),
		row({
			kernel: "tiled",
			n: 256,
			gops: 12,
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		}),
	];
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview).toBeDefined();
	if (!overview) return;
	const scoped = rowsForTab(overview, mixed, "f32", 32, makeCtx(mixed));
	expect(scoped.map((r) => r.gops)).toEqual([10, 11, 12]);
});

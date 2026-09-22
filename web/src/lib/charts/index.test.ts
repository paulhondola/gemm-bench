import { expect, test } from "bun:test";
import type { Row } from "../db";
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
	{
		kernel: "naive-ijk",
		precision: "f32",
		n: 256,
		threads: 1,
		gops: 2,
		backend: "cpu",
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	},
	{
		kernel: "naive-ijk",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 3,
		backend: "cpu",
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 256,
		threads: 1,
		gops: 10,
		backend: "cpu",
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 512,
		threads: 4,
		gops: 90,
		backend: "cpu",
		median_ms: 1,
		stddev_ms: 0,
		block_size: 32,
	},
];

test("every tab declares its own controls", () => {
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview?.controls).toEqual(["precision", "blockSize"]);
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.inertPrecision).toBe(true);
	const gpu = TABS.find((t) => t.id === "gpu");
	expect(gpu?.inertBlockSize).toBe(true);
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
		{
			kernel: "mps",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		},
		{
			kernel: "mps",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
		},
		{
			kernel: "rayon-ikj",
			precision: "f64",
			n: 256,
			threads: 4,
			gops: 40,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
		},
		{
			kernel: "rayon-ikj",
			precision: "f64",
			n: 512,
			threads: 4,
			gops: 70,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
		},
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
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 10,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 11,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 9999,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		},
	];
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview).toBeDefined();
	if (!overview) return;
	const scoped = rowsForTab(overview, twoBlockSizes, "f32", 32);
	expect(scoped.every((r) => r.block_size === 32)).toBe(true);
	expect(scoped).toHaveLength(2);
});

test("the Block size tab is absent with one block size, present with two", () => {
	const oneBlockSize: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 10,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
		{
			kernel: "tiled",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 20,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
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
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 12,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		},
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
		{
			kernel: "mps",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 93,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		},
		{
			kernel: "mps",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 738,
			backend: "metal",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 256,
			threads: 4,
			gops: 40,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 512,
			threads: 4,
			gops: 70,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
	];
	const ctx = makeCtx(withGpu2);
	const ids = visibleTabs(
		withGpu2,
		{ ...f, precision: "f32", blockSize: 32 },
		ctx,
	).map((t) => t.id);
	expect(ids).toContain("gpu");
});

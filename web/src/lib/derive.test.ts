import { expect, test } from "bun:test";
import type { Row } from "./db";
import {
	allSizes,
	BASELINE_KERNEL,
	bestPerKernel,
	blockSizes,
	blockSizesFor,
	defaultBlockSize,
	defaultBlockSizeFor,
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	families,
	hasKernel,
	hasSingleThreadBaseline,
	isPlottable,
	partitionPlottable,
	precisions,
	singleBlockSizeKernels,
	sizesFor,
} from "./derive";

const rows: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f16",
		n: 64,
		threads: 1,
		gops: 20,
		backend: "cpu",
	},
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});

const mixed: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 128,
		threads: 1,
		gops: 12,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 4,
		gops: 38,
		backend: "cpu",
	},
	{
		kernel: "mps",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 2,
		backend: "metal",
	},
	{
		kernel: "ikj",
		precision: "i64",
		n: 4096,
		threads: 1,
		gops: 6,
		backend: "cpu",
	},
];

test("family comes from the data, not the kernel name", () => {
	const f = families(mixed);
	expect(f.get("ikj")).toBe("serial");
	expect(f.get("rayon-ikj")).toBe("parallel");
	expect(f.get("mps")).toBe("gpu");
});

test("a metal kernel stays gpu even with only single-thread rows", () => {
	expect(
		families([
			{
				kernel: "mps",
				precision: "f32",
				n: 64,
				threads: 1,
				gops: 2,
				backend: "metal",
			},
		]).get("mps"),
	).toBe("gpu");
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

const threaded: Row[] = [
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 4,
		gops: 38,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 8,
		gops: 31,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 12,
		backend: "cpu",
	},
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
	expect(
		bestPerKernel(threaded)
			.map((r) => r.kernel)
			.sort(),
	).toEqual(["ikj", "rayon-ikj"]);
});

test("bestPerKernel keeps the first row on a tie", () => {
	const tied: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 10,
			backend: "cpu",
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 2,
			gops: 10,
			backend: "cpu",
		},
	];
	expect(bestPerKernel(tied)[0].threads).toBe(1);
});

test("bestPerKernel returns nothing for no rows", () => {
	expect(bestPerKernel([])).toEqual([]);
});

test("defaultParallelKernel picks the highest-gops parallel kernel at that precision", () => {
	// mixed has one parallel kernel at f32 (rayon-ikj, best row gops 38).
	expect(defaultParallelKernel(mixed, "f32")).toBe("rayon-ikj");
});

test("defaultParallelKernel returns empty when the precision has no parallel kernel", () => {
	// i64 in mixed only has a serial ikj row.
	expect(defaultParallelKernel(mixed, "i64")).toBe("");
});

const validRow: Row = {
	kernel: "ikj",
	precision: "f32",
	n: 64,
	threads: 1,
	gops: 10,
	backend: "cpu",
	median_ms: 1,
	stddev_ms: 0.1,
};

test("isPlottable rejects n = 0", () => {
	expect(isPlottable({ ...validRow, n: 0 })).toBe(false);
});

test("isPlottable rejects negative gops", () => {
	expect(isPlottable({ ...validRow, gops: -5 })).toBe(false);
});

test("isPlottable rejects NaN gops", () => {
	expect(isPlottable({ ...validRow, gops: Number.NaN })).toBe(false);
});

test("isPlottable rejects Infinity median_ms", () => {
	expect(
		isPlottable({ ...validRow, median_ms: Number.POSITIVE_INFINITY }),
	).toBe(false);
});

test("isPlottable rejects negative threads", () => {
	expect(isPlottable({ ...validRow, threads: -1 })).toBe(false);
});

test("isPlottable keeps a valid row with stddev_ms = 0", () => {
	// Zero standard deviation is legitimate (a perfectly consistent
	// measurement), not an error condition.
	expect(isPlottable({ ...validRow, stddev_ms: 0 })).toBe(true);
});

test("partitionPlottable reports the usable rows and the dropped count", () => {
	const rows = [validRow, { ...validRow, n: 0 }, { ...validRow, gops: -1 }];
	const { rows: usable, dropped } = partitionPlottable(rows);
	expect(usable).toEqual([validRow]);
	expect(dropped).toBe(2);
});

test("baseline guards detect what a partial sweep is missing", () => {
	expect(hasKernel(threaded, BASELINE_KERNEL)).toBe(false);
	expect(hasSingleThreadBaseline(threaded)).toBe(true);
	expect(hasSingleThreadBaseline(threaded.filter((r) => r.threads !== 1))).toBe(
		false,
	);
});

const blockRows: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
		block_size: 32,
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 128,
		threads: 1,
		gops: 12,
		backend: "cpu",
		block_size: 32,
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 256,
		threads: 1,
		gops: 14,
		backend: "cpu",
		block_size: 32,
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 9,
		backend: "cpu",
		block_size: 64,
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 128,
		threads: 1,
		gops: 11,
		backend: "cpu",
		block_size: 64,
	},
];

test("blockSizes lists each block size once, sorted", () => {
	expect(blockSizes(blockRows)).toEqual([32, 64]);
});

test("blockSizesFor narrows to the given precision and n", () => {
	expect(blockSizesFor(blockRows, "f32", 64)).toEqual([32, 64]);
	expect(blockSizesFor(blockRows, "f32", 256)).toEqual([32]);
});

test("defaultBlockSize picks the block size with the widest n coverage", () => {
	// 32 covers n = 64/128/256 (3 sizes); 64 covers only 64/128 (2). The bug
	// this guards: picking the larger block size, or the first one seen,
	// would return 64 here instead.
	expect(defaultBlockSize(blockRows)).toBe(32);
});

test("defaultBlockSize breaks a coverage tie numerically", () => {
	const tied: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 10,
			backend: "cpu",
			block_size: 128,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 128,
			threads: 1,
			gops: 12,
			backend: "cpu",
			block_size: 128,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 9,
			backend: "cpu",
			block_size: 64,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 128,
			threads: 1,
			gops: 11,
			backend: "cpu",
			block_size: 64,
		},
	];
	// Both block sizes cover n = 64/128 (a tie); the lower number wins so the
	// choice is stable rather than depending on array order.
	expect(defaultBlockSize(tied)).toBe(64);
});

test("defaultBlockSize is 0 for no rows", () => {
	expect(defaultBlockSize([])).toBe(0);
});

test("defaultBlockSizeFor recovers a selection stranded by an n change", () => {
	// block_size=64 is a real, valid selection at n=128 — the App.svelte
	// pickSize control's exact scenario is choosing 64 there, then moving to
	// n=256, which only has block_size=32.
	const stranded = 64;
	expect(blockSizesFor(blockRows, "f32", 128)).toContain(stranded);
	expect(blockSizesFor(blockRows, "f32", 256)).not.toContain(stranded);
	expect(defaultBlockSizeFor(blockRows, "f32", 256)).toBe(32);
});

test("defaultBlockSizeFor is 0 when nothing exists for that precision/n", () => {
	expect(defaultBlockSizeFor(blockRows, "f16", 256)).toBe(0);
	expect(defaultBlockSizeFor(blockRows, "f32", 4096)).toBe(0);
});

test("singleBlockSizeKernels: a kernel with two block sizes in the dataset is excluded, a kernel with one is included", () => {
	const mixed: Row[] = [
		...blockRows, // ikj: block_size 32 and 64 -> not single
		{
			kernel: "mps",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 900,
			backend: "metal",
			block_size: 32,
		},
	];
	const single = singleBlockSizeKernels(mixed);
	expect(single.has("mps")).toBe(true);
	expect(single.has("ikj")).toBe(false);
});

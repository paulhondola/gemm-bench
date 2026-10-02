import { expect, test } from "bun:test";
import type { Row } from "./db";
import {
	allSizes,
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	families,
	familyOf,
	familyPeak,
	formatParams,
	hasKernel,
	hasSingleThreadBaseline,
	isPlottable,
	knobNames,
	knobValues,
	knobValuesFor,
	partitionPlottable,
	pinKnobs,
	precisions,
	singleValueKernels,
	sizesFor,
} from "./derive";
import { peak, row } from "./fixtures";

const rows: Row[] = [
	row({ kernel: "ikj", n: 64, gops: 10 }),
	row({ kernel: "ikj", precision: "f16", n: 64, gops: 20 }),
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});

const mixed: Row[] = [
	row({ kernel: "ikj", n: 64, gops: 10 }),
	row({ kernel: "ikj", n: 128, gops: 12 }),
	row({ kernel: "rayon-ikj", n: 64, gops: 10 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 38 }),
	row({ kernel: "mps", n: 64, gops: 2, backend: "metal" }),
	row({ kernel: "ikj", precision: "i64", n: 4096, gops: 6 }),
];

test("family comes from the data, not the kernel name", () => {
	const f = families(mixed);
	expect(f.get("ikj")).toBe("serial");
	expect(f.get("rayon-ikj")).toBe("parallel");
	expect(f.get("mps")).toBe("gpu");
});

test("a metal kernel stays gpu even with only single-thread rows", () => {
	expect(
		families([row({ kernel: "mps", n: 64, gops: 2, backend: "metal" })]).get(
			"mps",
		),
	).toBe("gpu");
});

test("an amx kernel is its own family, not serial, despite threads=1", () => {
	expect(
		families([
			row({ kernel: "accelerate-blas", n: 64, gops: 400, backend: "matrix" }),
		]).get("accelerate-blas"),
	).toBe("matrix");
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
	row({ kernel: "rayon-ikj", n: 64, gops: 10 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 38 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 8, gops: 31 }),
	row({ kernel: "ikj", n: 64, gops: 12 }),
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
		row({ kernel: "ikj", n: 64, gops: 10 }),
		row({ kernel: "ikj", n: 64, threads: 2, gops: 10 }),
	];
	expect(bestPerKernel(tied)[0].threads).toBe(1);
});

test("bestPerKernel keeps one row per kernel, precision and size", () => {
	// The Precision tab passes every precision at once: without precision in the
	// key, a kernel's f16 and f32 rows would collapse into whichever is faster.
	const both: Row[] = [
		row({ kernel: "ikj", precision: "f16", n: 64, gops: 20 }),
		row({ kernel: "ikj", precision: "f32", n: 64, gops: 10 }),
		row({ kernel: "ikj", precision: "f32", n: 64, threads: 2, gops: 14 }),
	];
	const best = bestPerKernel(both);
	expect(best.map((r) => `${r.precision}@${r.gops}`).sort()).toEqual([
		"f16@20",
		"f32@14",
	]);
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

const validRow: Row = row({
	kernel: "ikj",
	n: 64,
	gops: 10,
	median_ms: 1,
	stddev_ms: 0.1,
});

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

test("formatParams lists name=value pairs", () => {
	expect(formatParams({ depth_block: 256, register_cols: 12 })).toBe(
		"depth_block=256 register_cols=12",
	);
	expect(formatParams({})).toBe("");
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

const knobRows: Row[] = [
	row({ kernel: "tiled", n: 64, gops: 10, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 128, gops: 12, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 256, gops: 14, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 64, gops: 9, swept: { tile_size: 64 } }),
	row({ kernel: "tiled", n: 128, gops: 11, swept: { tile_size: 64 } }),
	row({ kernel: "packed", n: 64, gops: 30, swept: { depth_block: 256 } }),
	row({ kernel: "ikj", n: 64, gops: 5 }),
];

test("knobNames lists each swept knob once, sorted", () => {
	expect(knobNames(knobRows)).toEqual(["depth_block", "tile_size"]);
});

test("knobValues lists one knob's values once, sorted", () => {
	expect(knobValues(knobRows, "tile_size")).toEqual([32, 64]);
	expect(knobValues(knobRows, "depth_block")).toEqual([256]);
});

test("knobValuesFor narrows to the given precision and n", () => {
	expect(knobValuesFor(knobRows, "tile_size", "f32", 64)).toEqual([32, 64]);
	expect(knobValuesFor(knobRows, "tile_size", "f32", 256)).toEqual([32]);
	expect(knobValuesFor(knobRows, "tile_size", "f16", 64)).toEqual([]);
});

test("pinKnobs keeps a pin still measured there and moves a stranded one to the smallest value", () => {
	// Tile 64 is valid at n=128, but n=256 has only 32 (the pickSize scenario).
	expect(pinKnobs(knobRows, "f32", 128, { tile_size: 64 })).toEqual({
		tile_size: 64,
	});
	expect(pinKnobs(knobRows, "f32", 256, { tile_size: 64 })).toEqual({
		tile_size: 32,
	});
	expect(pinKnobs(knobRows, "f32", 64, {})).toEqual({
		depth_block: 256,
		tile_size: 32,
	});
});

test("pinKnobs leaves out a knob with no values at that size", () => {
	expect(pinKnobs(knobRows, "f32", 4096, { tile_size: 32 })).toEqual({});
});

test("singleValueKernels: per knob, the kernels measured at only one value", () => {
	const single = singleValueKernels(knobRows);
	expect(single.get("depth_block")?.has("packed")).toBe(true);
	expect(single.get("tile_size")?.has("tiled")).toBe(false);
	expect([...single.values()].some((kernels) => kernels.has("ikj"))).toBe(
		false,
	);
});

test("bestPerFamily keeps each family's winning row per precision and size", () => {
	const rows: Row[] = [
		row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 174 }),
		row({ kernel: "rayon-tiled", n: 512, threads: 8, gops: 161 }),
		row({
			kernel: "rayon-tiled",
			precision: "i32",
			n: 512,
			threads: 8,
			gops: 167,
		}),
		row({ kernel: "mps", n: 512, gops: 699, backend: "metal" }),
		row({ kernel: "metal-tiled", n: 512, gops: 268, backend: "metal" }),
	];
	const best = bestPerFamily(rows, families(rows));
	expect(best.map((r) => `${r.kernel}@${r.precision}`).sort()).toEqual([
		"mps@f32",
		"rayon-ikj@f32",
		"rayon-tiled@i32",
	]);
});

test("familyOf counts a kernel the family map never saw as serial", () => {
	expect(familyOf(row({ kernel: "mystery", n: 64, gops: 1 }), new Map())).toBe(
		"serial",
	);
});

const M1_PEAKS = [
	peak({ cores: 8, gflops: 777 }),
	peak({ cores: 1, gflops: 103 }),
	peak({ backend: "metal", cores: 16, gflops: 5308 }),
];

test("familyPeak: serial takes the 1-core row, even when the 8-core row is listed first", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M1 Pro", "f32")?.gflops).toBe(
		103,
	);
});

test("familyPeak: parallel takes the widest cpu row", () => {
	const peaks = [
		peak({ cores: 1, gflops: 103 }),
		peak({ cores: 8, gflops: 777 }),
		peak({ cores: 4, gflops: 400 }),
	];
	expect(familyPeak(peaks, "parallel", "Apple M1 Pro", "f32")?.cores).toBe(8);
});

test("familyPeak: parallel gets nothing when the cpu only has a 1-core row", () => {
	// A 1-core ceiling is the serial one; drawing it over a parallel family
	// would make every multi-thread result look like it broke the peak.
	expect(
		familyPeak([peak({ cores: 1 })], "parallel", "Apple M1 Pro", "f32"),
	).toBeUndefined();
});

test("familyPeak: gpu takes the metal row, never a cpu one", () => {
	const found = familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32");
	expect(found?.backend).toBe("metal");
	expect(found?.gflops).toBe(5308);
	expect(
		familyPeak([peak({ cores: 8 })], "gpu", "Apple M1 Pro", "f32"),
	).toBeUndefined();
});

test("familyPeak: amx has no peak, even with cpu and metal rows present", () => {
	expect(familyPeak(M1_PEAKS, "matrix", "Apple M1 Pro", "f32")).toBeUndefined();
});

test("familyPeak: another device gets nothing", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M3", "f32")).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M3", "f32")).toBeUndefined();
});

test("familyPeak: an integer precision gets nothing when only f32 rows exist", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M1 Pro", "i32")).toBeUndefined();
	expect(
		familyPeak(M1_PEAKS, "parallel", "Apple M1 Pro", "i32"),
	).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "i32")).toBeUndefined();
});

test("familyPeak: only rows of the asked precision count", () => {
	const peaks = [
		peak({ precision: "f16", cores: 1, gflops: 206 }),
		peak({ precision: "f32", cores: 1, gflops: 103 }),
	];
	expect(familyPeak(peaks, "serial", "Apple M1 Pro", "f16")?.gflops).toBe(206);
});

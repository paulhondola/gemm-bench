import { expect, test } from "bun:test";
import type { Row } from "../db";
import { legendOf, plotted, pointsOf, row } from "../fixtures";
import { blockSizeSweep } from "./blocksize";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "rayon-ikj",
	blockSize: 32,
	relative: false,
};

const rows: Row[] = [
	// tiled blocks: its gops actually moves between block sizes.
	row({ kernel: "tiled", n: 512, gops: 30, block_size: 32 }),
	row({ kernel: "tiled", n: 512, gops: 50, block_size: 64 }),
	// ikj doesn't block: the two rows are repeat runs, near-identical.
	row({ kernel: "ikj", n: 512, gops: 20, block_size: 32 }),
	row({ kernel: "ikj", n: 512, gops: 20.1, block_size: 64 }),
];

test("the sweep chart builds when two block sizes exist", () => {
	expect(blockSizeSweep(rows, f, makeCtx(rows))).not.toBeNull();
});

test("a single block size is not a sweep", () => {
	const single = rows.filter((r) => r.block_size === 32);
	expect(blockSizeSweep(single, f, makeCtx(single))).toBeNull();
});

test("no rows, no chart", () => {
	expect(blockSizeSweep([], f, makeCtx([]))).toBeNull();
});

test("pins n: a row at a different size does not leak into the sweep", () => {
	const otherSize: Row[] = [
		...rows,
		row({ kernel: "tiled", n: 1024, gops: 999, block_size: 128 }),
	];
	const spec = blockSizeSweep(otherSize, f, makeCtx(otherSize));
	expect(spec).not.toBeNull();
	// block_size=128 exists only at n=1024, which f.n=512 must exclude.
	expect(spec?.layout.xaxis?.tickvals).toEqual([32, 64]);
	expect(pointsOf(spec, "tiled").some((p) => p.x === 128)).toBe(false);
});

test("takes the best result per (kernel, block_size), not an arbitrary thread row", () => {
	const withThreads: Row[] = [
		row({ kernel: "rayon-ikj", n: 512, gops: 10, block_size: 32 }),
		row({ kernel: "rayon-ikj", n: 512, threads: 4, gops: 90, block_size: 32 }),
		row({ kernel: "rayon-ikj", n: 512, threads: 4, gops: 95, block_size: 64 }),
	];
	const spec = blockSizeSweep(withThreads, f, makeCtx(withThreads));
	const at32 = pointsOf(spec, "rayon-ikj").find((p) => p.x === 32);
	// 90 is the best of the two threads=1/threads=4 rows at block_size=32;
	// a bug that pinned threads instead of taking the max would report 10.
	expect(at32?.y).toBe(90);
});

test("a kernel missing a block size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		row({ kernel: "tiled", n: 512, gops: 30, block_size: 32 }),
		row({ kernel: "tiled", n: 512, gops: 50, block_size: 64 }),
		// ikj has no block_size=64 row at n=512.
		row({ kernel: "ikj", n: 512, gops: 20, block_size: 32 }),
		// ikj does have a block_size=64 row elsewhere (n=1024), so across the
		// dataset it's a genuinely swept kernel, not a single-block-size one —
		// the gap below is raggedness at n=512, not the whole kernel missing.
		row({ kernel: "ikj", n: 1024, gops: 22, block_size: 64 }),
	];
	const spec = blockSizeSweep(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	const gap = pointsOf(spec, "ikj").find((p) => p.x === 64);
	expect(gap?.y).toBeNull();
});

test("a kernel with only one block size is excluded, even at a dominant gops", () => {
	// mps was measured at exactly one block size but at a much larger gops
	// than the swept kernels — on a linear axis it would flatten the actual
	// comparison (tiled 30->50) into a sliver at the bottom.
	const withDominant: Row[] = [
		...rows,
		row({ kernel: "mps", n: 512, gops: 660, backend: "gpu", block_size: 32 }),
	];
	const spec = blockSizeSweep(withDominant, f, makeCtx(withDominant));
	expect(spec).not.toBeNull();
	const maxPlotted = Math.max(...plotted(spec).map((p) => Number(p.y)));
	// 660 (mps) must not leak into the plotted range; the swept kernels top
	// out at tiled's 50.
	expect(maxPlotted).toBe(50);
	expect(legendOf(spec).names).not.toContain("mps");
});

test("the legend lists only the kernels actually plotted", () => {
	// rayon-ikj is in ctx.palette (whole dataset) but only has an n=1024 row,
	// which f.n=512 excludes — so it must be absent from the plotted legend.
	// Reverting rowsForTab back to the raw palette keys would still include it.
	const withUnplottedKernel: Row[] = [
		...rows,
		row({
			kernel: "rayon-ikj",
			n: 1024,
			threads: 4,
			gops: 200,
			block_size: 32,
		}),
	];
	const spec = blockSizeSweep(
		withUnplottedKernel,
		f,
		makeCtx(withUnplottedKernel),
	);
	const { names } = legendOf(spec);
	expect(names).toEqual(expect.arrayContaining(["tiled", "ikj"]));
	expect(names).toHaveLength(2);
});

test("a row without a block size is never plotted", () => {
	// Mixed old/new data: ikj has 32/64 from old runs plus a new row with no
	// block size. Number(null) is 0, which a log-scale x-axis cannot place.
	const withNull: Row[] = [
		...rows,
		row({ kernel: "ikj", n: 512, gops: 25, block_size: null }),
	];
	const spec = blockSizeSweep(withNull, f, makeCtx(withNull));
	expect(spec).not.toBeNull();
	expect(plotted(spec).every((p) => Number(p.x) > 0)).toBe(true);
});

test("a kernel with old @64 and new null rows is still excluded as single-block-size", () => {
	// Old committed runs recorded block_size=64 for every kernel, including
	// non-tiling ones like mps; new runs leave it null for them. Naively
	// collecting Number(r.block_size) (Number(null) === 0) makes mps look like
	// it has two distinct block sizes (64 and 0), so singleBlockSizeKernels
	// stops exempting it, and its lone old @64 row reaches this chart as a fake
	// swept point.
	const mixedOldAndNew: Row[] = [
		row({ kernel: "tiled", n: 512, gops: 30, block_size: 32 }),
		row({ kernel: "tiled", n: 512, gops: 50, block_size: 64 }),
		row({ kernel: "mps", n: 512, gops: 900, backend: "metal", block_size: 64 }),
		row({
			kernel: "mps",
			n: 512,
			gops: 910,
			backend: "metal",
			block_size: null,
		}),
	];
	const spec = blockSizeSweep(mixedOldAndNew, f, makeCtx(mixedOldAndNew));
	expect(spec).not.toBeNull();
	expect(legendOf(spec).names).not.toContain("mps");
});

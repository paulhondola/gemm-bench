import { expect, test } from "bun:test";
import type { Row } from "../db";
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
	{
		kernel: "tiled",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 30,
		backend: "cpu",
		block_size: 32,
	},
	{
		kernel: "tiled",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 50,
		backend: "cpu",
		block_size: 64,
	},
	// ikj doesn't block: the two rows are repeat runs, near-identical.
	{
		kernel: "ikj",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 20,
		backend: "cpu",
		block_size: 32,
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 20.1,
		backend: "cpu",
		block_size: 64,
	},
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
		{
			kernel: "tiled",
			precision: "f32",
			n: 1024,
			threads: 1,
			gops: 999,
			backend: "cpu",
			block_size: 128,
		},
	];
	const spec = blockSizeSweep(otherSize, f, makeCtx(otherSize));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const line = spec.marks[0] as {
		data: { block_size: number; kernel: string; gops: number | null }[];
	};
	// block_size=128 exists only at n=1024, which f.n=512 must exclude.
	expect(line.data.some((d) => d.block_size === 128)).toBe(false);
});

test("takes the best result per (kernel, block_size), not an arbitrary thread row", () => {
	const withThreads: Row[] = [
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 10,
			backend: "cpu",
			block_size: 32,
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 512,
			threads: 4,
			gops: 90,
			backend: "cpu",
			block_size: 32,
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 512,
			threads: 4,
			gops: 95,
			backend: "cpu",
			block_size: 64,
		},
	];
	const spec = blockSizeSweep(withThreads, f, makeCtx(withThreads));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const dot = spec.marks[1] as { data: { block_size: number; gops: number }[] };
	const at32 = dot.data.find((d) => d.block_size === 32);
	// 90 is the best of the two threads=1/threads=4 rows at block_size=32;
	// a bug that pinned threads instead of taking the max would report 10.
	expect(at32?.gops).toBe(90);
});

test("a kernel missing a block size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		{
			kernel: "tiled",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 30,
			backend: "cpu",
			block_size: 32,
		},
		{
			kernel: "tiled",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 50,
			backend: "cpu",
			block_size: 64,
		},
		// ikj has no block_size=64 row at n=512.
		{
			kernel: "ikj",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 20,
			backend: "cpu",
			block_size: 32,
		},
		// ikj does have a block_size=64 row elsewhere (n=1024), so across the
		// dataset it's a genuinely swept kernel, not a single-block-size one —
		// the gap below is raggedness at n=512, not the whole kernel missing.
		{
			kernel: "ikj",
			precision: "f32",
			n: 1024,
			threads: 1,
			gops: 22,
			backend: "cpu",
			block_size: 64,
		},
	];
	const spec = blockSizeSweep(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const line = spec.marks[0] as {
		data: { kernel: string; block_size: number; gops: number | null }[];
	};
	const gap = line.data.find((d) => d.kernel === "ikj" && d.block_size === 64);
	expect(gap?.gops).toBeNull();
});

test("a kernel with only one block size is excluded, even at a dominant gops", () => {
	// mps was measured at exactly one block size but at a much larger gops
	// than the swept kernels — on a linear axis it would flatten the actual
	// comparison (tiled 30->50) into a sliver at the bottom.
	const withDominant: Row[] = [
		...rows,
		{
			kernel: "mps",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 660,
			backend: "gpu",
			block_size: 32,
		},
	];
	const spec = blockSizeSweep(withDominant, f, makeCtx(withDominant));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const dot = spec.marks[1] as { data: { kernel: string; gops: number }[] };
	expect(dot.data.some((d) => d.kernel === "mps")).toBe(false);
	const maxPlotted = Math.max(...dot.data.map((d) => d.gops));
	// 660 (mps) must not leak into the plotted range; the swept kernels top
	// out at tiled's 50.
	expect(maxPlotted).toBe(50);
	expect(spec.color?.domain).not.toContain("mps");
});

test("the legend lists only the kernels actually plotted", () => {
	// rayon-ikj is in ctx.palette (whole dataset) but only has an n=1024 row,
	// which f.n=512 excludes — so it must be absent from the plotted legend.
	// Reverting rowsForTab back to the raw palette keys would still include it.
	const withUnplottedKernel: Row[] = [
		...rows,
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 1024,
			threads: 4,
			gops: 200,
			backend: "cpu",
			block_size: 32,
		},
	];
	const spec = blockSizeSweep(
		withUnplottedKernel,
		f,
		makeCtx(withUnplottedKernel),
	);
	expect(spec).not.toBeNull();
	if (!spec) return;
	expect(spec.color?.domain).toEqual(expect.arrayContaining(["tiled", "ikj"]));
	expect(spec.color?.domain).toHaveLength(2);
});

test("a row without a block size is never plotted", () => {
	// Mixed old/new data: ikj has 32/64 from old runs plus a new row with no
	// block size. Number(null) is 0, which a log-scale x-axis cannot place.
	const withNull: Row[] = [
		...rows,
		{
			kernel: "ikj",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 25,
			backend: "cpu",
			block_size: null,
		},
	];
	const spec = blockSizeSweep(withNull, f, makeCtx(withNull));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const dot = spec.marks[1] as { data: { block_size: number }[] };
	expect(dot.data.every((d) => d.block_size > 0)).toBe(true);
});

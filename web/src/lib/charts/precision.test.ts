import { expect, test } from "bun:test";
import type { Row } from "../db";
import { throughputByPrecision } from "./precision";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 64,
	kernel: "ikj",
	blockSize: 32,
	relative: false,
};

const rows: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 30,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "i64",
		n: 64,
		threads: 1,
		gops: 6,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 4,
		gops: 90,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "i64",
		n: 64,
		threads: 4,
		gops: 20,
		backend: "cpu",
	},
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

test("the legend lists only the kernels plotted, not the whole palette", () => {
	const withUnplotted: Row[] = [
		...rows,
		{
			kernel: "tiled",
			precision: "f32",
			n: 128,
			threads: 1,
			gops: 40,
			backend: "cpu",
		},
	];
	// tiled only has an n=128 row, so at f.n=64 it must not appear in the legend.
	const spec = throughputByPrecision(withUnplotted, f, makeCtx(withUnplotted));
	expect(spec).not.toBeNull();
	if (!spec) return;
	expect(spec.color?.domain).toEqual(
		expect.arrayContaining(["ikj", "rayon-ikj"]),
	);
	expect(spec.color?.domain).toHaveLength(2);
});

test("a row at a different size does not leak into the pinned size", () => {
	// The best-per-(kernel,precision) map keys on kernel+precision, not n, so
	// a missing `f.n` filter would let this n=128 row's huge gops win over
	// the real n=64 ikj/i64 result (6).
	const multiSize: Row[] = [
		...rows,
		{
			kernel: "ikj",
			precision: "i64",
			n: 128,
			threads: 1,
			gops: 999,
			backend: "cpu",
		},
	];
	const spec = throughputByPrecision(multiSize, f, makeCtx(multiSize));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const bars = (
		spec.marks[0] as {
			data: { kernel: string; precision: string; gops: number }[];
		}
	).data;
	const ikjAtI64 = bars.find(
		(b) => b.kernel === "ikj" && b.precision === "i64",
	);
	expect(ikjAtI64?.gops).toBe(6);
});

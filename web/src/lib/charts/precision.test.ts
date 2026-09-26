import { expect, test } from "bun:test";
import type { Row } from "../db";
import { legendOf, plotted, pointsOf, row } from "../fixtures";
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
	row({ kernel: "ikj", n: 64, gops: 30 }),
	row({ kernel: "ikj", precision: "i64", n: 64, gops: 6 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 90 }),
	row({ kernel: "rayon-ikj", precision: "i64", n: 64, threads: 4, gops: 20 }),
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
	expect(spec?.layout.xaxis?.categoryarray).toEqual(["f32", "i64"]);
});

test("one bar per family, in legend order and family ink", () => {
	const spec = throughputByPrecision(rows, f, makeCtx(rows));
	expect(legendOf(spec)).toEqual({
		names: ["serial", "parallel"],
		colors: ["#844da2", "#008300"],
	});
});

test("a row at a different size does not leak into the pinned size", () => {
	// A missing `f.n` filter would let this n=128 row's huge gops win the
	// serial bar at i64 over the real n=64 ikj result (6).
	const multiSize: Row[] = [
		...rows,
		row({ kernel: "ikj", precision: "i64", n: 128, gops: 999 }),
	];
	const spec = throughputByPrecision(multiSize, f, makeCtx(multiSize));
	const serialAtI64 = pointsOf(spec, "serial").find((b) => b.x === "i64");
	expect(serialAtI64?.y).toBe(6);
});

test("the i32 group has a GPU bar and no AMX bar", () => {
	const mixed: Row[] = [
		row({ kernel: "accelerate-blas", n: 64, gops: 400, backend: "amx" }),
		row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 27 }),
		row({
			kernel: "rayon-ikj",
			precision: "i32",
			n: 64,
			threads: 4,
			gops: 27,
		}),
		row({
			kernel: "metal-tiled",
			precision: "i32",
			n: 64,
			gops: 2,
			backend: "metal",
		}),
	];
	const spec = throughputByPrecision(mixed, f, makeCtx(mixed));
	const at = (p: string) =>
		plotted(spec)
			.filter((b) => b.x === p)
			.map((b) => b.series)
			.sort();
	expect(at("i32")).toEqual(["gpu", "parallel"]);
	expect(at("f32")).toEqual(["amx", "parallel"]);
});

import { expect, test } from "bun:test";
import type { ScatterData } from "plotly.js-dist-min";
import type { Row } from "../data/db";
import { legendOf, plotted, pointsOf, row } from "../test/fixtures";
import { accuracyVsThroughput, throughputByPrecision } from "./precision";
import { type Filters, makeCtx, uidOf } from "./types";

const f: Filters = {
	precision: "f32",
	n: 64,
	kernel: "ikj",
	knobs: {},
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
		row({ kernel: "accelerate-blas", n: 64, gops: 400, backend: "matrix" }),
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
	expect(at("f32")).toEqual(["matrix", "parallel"]);
});

/** The accuracy chart's trace for one (family, precision). */
const accuracyTrace = (
	spec: ReturnType<typeof accuracyVsThroughput>,
	family: string,
	precision: string,
) => spec?.data.find((t) => t.uid === uidOf(`${family} ${precision}`));

/** Rows are listed out of trace order, so the order test means something. */
const accuracyRows: Row[] = [
	row({
		kernel: "metal-tiled",
		n: 64,
		gops: 30,
		backend: "metal",
		mean_rel_error_f64: 2e-7,
	}),
	row({
		kernel: "mps",
		precision: "f16",
		n: 64,
		gops: 90,
		backend: "metal",
		mean_rel_error_f64: 1.3e-4,
	}),
	row({
		kernel: "accelerate-blas",
		precision: "f64",
		n: 64,
		gops: 400,
		backend: "matrix",
		mean_rel_error_f64: 3.4e-18,
	}),
	row({
		kernel: "rayon-ikj",
		n: 64,
		threads: 2,
		gops: 30,
		mean_rel_error_f64: 9e-7,
	}),
	row({
		kernel: "rayon-ikj",
		n: 64,
		threads: 4,
		gops: 40,
		mean_rel_error_f64: 4e-7,
	}),
	row({ kernel: "ikj", n: 64, gops: 12, mean_rel_error_f64: 3e-7 }),
	row({
		kernel: "ikj",
		precision: "f16",
		n: 64,
		gops: 10,
		mean_rel_error_f64: 6.6e-2,
	}),
];

const accuracy = (rs: Row[], filters: Filters = f) =>
	accuracyVsThroughput(rs, filters, makeCtx(rs));

test("one trace per family and precision, in family then float-precision order", () => {
	const spec = accuracy(accuracyRows);
	expect(spec?.data.map((t) => t.uid)).toEqual([
		uidOf("serial f16"),
		uidOf("serial f32"),
		uidOf("parallel f32"),
		uidOf("matrix f64"),
		uidOf("gpu f16"),
		uidOf("gpu f32"),
	]);
});

test("each trace is named for its precision and grouped under its family", () => {
	const spec = accuracy(accuracyRows);
	expect(
		spec?.data.map((t) => [t.legendgroup, t.legendgrouptitle?.text, t.name]),
	).toEqual([
		["serial", "serial", "f16"],
		["serial", "serial", "f32"],
		["parallel", "parallel", "f32"],
		["matrix", "matrix", "f64"],
		["gpu", "gpu", "f16"],
		["gpu", "gpu", "f32"],
	]);
});

test("colour is the family and the marker shape is the precision", () => {
	const spec = accuracy(accuracyRows);
	const markers = (spec?.data ?? []).map(
		(t) => (t as Partial<ScatterData>).marker,
	);
	expect(markers.map((m) => [m?.color, m?.symbol, m?.size])).toEqual([
		["#844da2", "circle", 10],
		["#844da2", "square", 10],
		["#008300", "square", 10],
		["#3987e5", "diamond", 10],
		["#e66767", "circle", 10],
		["#e66767", "square", 10],
	]);
});

test("a kernel is one point per precision, at its fastest row's error", () => {
	// rayon-ikj has two f32 rows: the 4-thread one is faster, so its error and
	// thread count are the ones plotted, not the 2-thread row's.
	const spec = accuracy(accuracyRows);
	const parallel = accuracyTrace(spec, "parallel", "f32");
	expect(parallel?.x).toEqual([4e-7]);
	expect(parallel?.y).toEqual([40]);
	expect(parallel?.customdata).toEqual([["rayon-ikj", 4]]);
	// ikj has an f16 and an f32 point: precision is part of its identity.
	expect(accuracyTrace(spec, "serial", "f16")?.x).toEqual([6.6e-2]);
	expect(accuracyTrace(spec, "serial", "f32")?.x).toEqual([3e-7]);
});

test("exact, non-finite and integer rows are left out", () => {
	const extra: Row[] = [
		...accuracyRows,
		// An f64 CPU kernel adds in the reference's order: error exactly 0.
		row({
			kernel: "static-ikj",
			precision: "f64",
			n: 64,
			threads: 4,
			gops: 50,
			mean_rel_error_f64: 0,
		}),
		// SQLite stores a NaN error as NULL.
		row({ kernel: "tiled", n: 64, gops: 20, mean_rel_error_f64: null }),
		// Integers are exact in practice; the precision filter, not the error
		// filter, is what keeps this one out.
		row({
			kernel: "static-tiled",
			precision: "i32",
			n: 64,
			gops: 20,
			mean_rel_error_f64: 0.5,
		}),
	];
	const spec = accuracy(extra);
	const kernels = spec?.data.flatMap((t) =>
		((t.customdata ?? []) as string[][]).map((c) => c[0]),
	);
	expect(kernels?.sort()).toEqual([
		"accelerate-blas",
		"ikj",
		"ikj",
		"metal-tiled",
		"mps",
		"rayon-ikj",
	]);
	// A precision left with no point gets no empty legend entry.
	expect(accuracyTrace(spec, "parallel", "f64")).toBeUndefined();
});

test("an infinite error (a kernel that produced NaN) is left out of the accuracy chart", () => {
	const rows = [
		row({ kernel: "ikj", n: 512, gops: 20, mean_rel_error_f64: 1e-6 }),
		row({
			kernel: "tiled",
			n: 512,
			gops: 25,
			mean_rel_error_f64: Number.POSITIVE_INFINITY,
		}),
	];
	const spec = accuracyVsThroughput(rows, { ...f, n: 512 }, makeCtx(rows));
	expect(plotted(spec).every((p) => Number.isFinite(Number(p.x)))).toBe(true);
});

test("f.n pins the size", () => {
	// A missing size filter would let this n=128 row win the serial f32 point.
	const multiSize: Row[] = [
		...accuracyRows,
		row({ kernel: "ikj", n: 128, gops: 999, mean_rel_error_f64: 1e-3 }),
	];
	const serial = accuracyTrace(accuracy(multiSize), "serial", "f32");
	expect(serial?.x).toEqual([3e-7]);
	expect(serial?.y).toEqual([12]);
	expect(
		accuracyTrace(accuracy(multiSize, { ...f, n: 128 }), "serial", "f32")?.x,
	).toEqual([1e-3]);
});

test("the axes are log, with power-of-ten error ticks", () => {
	const { layout } = accuracy(accuracyRows) ?? {};
	expect(layout?.hovermode).toBe("closest");
	expect(layout?.xaxis?.type).toBe("log");
	expect(layout?.xaxis?.exponentformat).toBe("power");
	expect(layout?.yaxis?.type).toBe("log");
	// Each legend entry hides its own points, not its whole family.
	expect(layout?.legend?.groupclick).toBe("toggleitem");
});

test("no chart when every float result is exact, missing or an integer", () => {
	const exact: Row[] = [
		row({
			kernel: "ikj",
			precision: "f64",
			n: 64,
			gops: 10,
			mean_rel_error_f64: 0,
		}),
		row({ kernel: "tiled", n: 64, gops: 12, mean_rel_error_f64: null }),
		row({
			kernel: "ikj",
			precision: "i32",
			n: 64,
			gops: 9,
			mean_rel_error_f64: 0.1,
		}),
	];
	expect(accuracy(exact)).toBeNull();
	expect(accuracy([])).toBeNull();
});

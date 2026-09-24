import { expect, test } from "bun:test";
import type { Row } from "../db";
import { UNPALETTED_FILL } from "../palette";
import {
	canShowSpeedup,
	fastestPerSize,
	serialOnly,
	throughputVsSize,
} from "./overview";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 128,
	kernel: "rayon-ikj",
	blockSize: 32,
	relative: false,
};

const rows: Row[] = [
	{
		kernel: "naive-ijk",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 2,
		backend: "cpu",
		stddev_ms: 0.1,
		median_ms: 1,
	},
	{
		kernel: "naive-ijk",
		precision: "f32",
		n: 128,
		threads: 1,
		gops: 3,
		backend: "cpu",
		stddev_ms: 0.1,
		median_ms: 1,
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 4,
		gops: 30,
		backend: "cpu",
		stddev_ms: 0.1,
		median_ms: 1,
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 128,
		threads: 4,
		gops: 90,
		backend: "cpu",
		stddev_ms: 0.1,
		median_ms: 1,
	},
];

test("the headline chart builds when two sizes exist", () => {
	expect(throughputVsSize(rows, f, makeCtx(rows))).not.toBeNull();
});

test("one size is not a trend", () => {
	const single = rows.filter((r) => r.n === 64);
	expect(throughputVsSize(single, f, makeCtx(single))).toBeNull();
});

test("no rows, no chart", () => {
	expect(throughputVsSize([], f, makeCtx([]))).toBeNull();
	expect(fastestPerSize([], f, makeCtx([]))).toBeNull();
	expect(serialOnly([], f, makeCtx([]))).toBeNull();
});

test("the speedup projection needs a naive-ijk baseline", () => {
	expect(canShowSpeedup(rows)).toBe(true);
	expect(canShowSpeedup(rows.filter((r) => r.kernel !== "naive-ijk"))).toBe(
		false,
	);
});

test("the legend lists only the kernels plotted, not the whole palette", () => {
	// serialOnly is fed only naive-ijk rows here, so rayon-ikj (present
	// elsewhere in the palette) must not appear in the legend domain.
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	if (!spec) return;
	expect(spec.color?.domain).toEqual(["naive-ijk"]);
});

test("serialOnly drops the parallel kernels", () => {
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	if (!spec) return;
	// Assert on the plotted points, not on the whole spec: color.domain always
	// lists every kernel in the dataset so that filtering cannot repaint.
	const plotted = new Set(
		(spec.marks[0] as { data: { kernel: string }[] }).data.map((d) => d.kernel),
	);
	expect(plotted).toEqual(new Set(["naive-ijk"]));
});

test("a kernel missing a row at one size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 30,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
		// ikj has no n=128 row; naive-ijk does, so the union x-axis includes 128.
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 50,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
		{
			kernel: "naive-ijk",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 3,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
		{
			kernel: "naive-ijk",
			precision: "f32",
			n: 128,
			threads: 1,
			gops: 4,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
		{
			kernel: "naive-ijk",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 5,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
	];
	const spec = throughputVsSize(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	if (!spec) return;
	// marks[0] is Plot.areaY(lineData, ...) and marks[1] is Plot.line(lineData,
	// ...) — confirmed by introspecting spec.marks[i].data for this exact
	// fixture: both index 0 and 1 carried the gap-filled data (a
	// threads/lo/hi/y: null entry for ikj at n=128); index 2 (dot) and index 3
	// (tip) carried only the real points.
	const line = spec.marks[1] as {
		data: { kernel: string; n: number; y: number | null }[];
	};
	const gap = line.data.find((d) => d.kernel === "ikj" && d.n === 128);
	expect(gap?.y).toBeNull();
});

test("the stddev band stays finite when stddev exceeds the median", () => {
	const noisy: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 20,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 1.5,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 128,
			threads: 1,
			gops: 25,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0.01,
		},
	];
	const spec = throughputVsSize(noisy, f, makeCtx(noisy));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const band = (spec.marks[0] as { data: { hi: number }[] }).data;
	for (const point of band) {
		expect(Number.isFinite(point.hi)).toBe(true);
		expect(point.hi).toBeLessThan(100);
	}
});

test("a kernel outside the palette still gets a visible, defined fill when it wins a size", () => {
	const tenKnown = [
		"accelerate-blas",
		"accelerate-bnns",
		"naive-ijk",
		"ikj",
		"tiled",
		"rayon-ikj",
		"static-ikj",
		"rayon-tiled",
		"static-tiled",
		"mps",
	];
	const elevenKernels: Row[] = [
		...tenKnown.map((kernel) => ({
			kernel,
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 10,
			backend: "cpu",
		})),
		{
			kernel: "packed-simd",
			precision: "f32",
			n: 64,
			threads: 1,
			gops: 999,
			backend: "cpu",
		},
	];
	const ctx = makeCtx(elevenKernels);
	// 9 slots + the baseline ink; an 11th kernel has no entry.
	expect(ctx.palette.has("packed-simd")).toBe(false);

	const spec = fastestPerSize(elevenKernels, f, ctx);
	expect(spec).not.toBeNull();
	if (!spec) return;
	const color = spec.color as { domain: string[]; range: string[] };
	const idx = color.domain.indexOf("packed-simd");
	expect(idx).not.toBe(-1);
	expect(color.range[idx]).toBe(UNPALETTED_FILL);
});

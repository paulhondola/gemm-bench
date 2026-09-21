import { expect, test } from "bun:test";
import type { Row } from "../db";
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

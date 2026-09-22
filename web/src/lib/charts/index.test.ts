import { expect, test } from "bun:test";
import type { Row } from "../db";
import { TABS, visibleTabs } from "./index";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "rayon-ikj",
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
	},
];

test("every tab declares its own controls", () => {
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview?.controls).toEqual(["precision"]);
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.inertPrecision).toBe(true);
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

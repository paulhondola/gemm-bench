import { expect, test } from "bun:test";
import type { Row } from "../db";
import { row } from "../fixtures";
import {
	canShowSpeedup,
	fastestPerSize,
	serialOnly,
	throughputByFamily,
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
	row({ kernel: "naive-ijk", n: 64, gops: 2, stddev_ms: 0.1, median_ms: 1 }),
	row({ kernel: "naive-ijk", n: 128, gops: 3, stddev_ms: 0.1, median_ms: 1 }),
	row({
		kernel: "rayon-ikj",
		n: 64,
		threads: 4,
		gops: 30,
		stddev_ms: 0.1,
		median_ms: 1,
	}),
	row({
		kernel: "rayon-ikj",
		n: 128,
		threads: 4,
		gops: 90,
		stddev_ms: 0.1,
		median_ms: 1,
	}),
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
	expect(throughputByFamily([], f, makeCtx([]))).toBeNull();
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
		row({ kernel: "ikj", n: 64, gops: 30, median_ms: 1, stddev_ms: 0.01 }),
		// ikj has no n=128 row; naive-ijk does, so the union x-axis includes 128.
		row({ kernel: "ikj", n: 256, gops: 50, median_ms: 1, stddev_ms: 0.01 }),
		row({ kernel: "naive-ijk", n: 64, gops: 3, median_ms: 1, stddev_ms: 0.01 }),
		row({
			kernel: "naive-ijk",
			n: 128,
			gops: 4,
			median_ms: 1,
			stddev_ms: 0.01,
		}),
		row({
			kernel: "naive-ijk",
			n: 256,
			gops: 5,
			median_ms: 1,
			stddev_ms: 0.01,
		}),
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
		row({ kernel: "ikj", n: 64, gops: 20, median_ms: 1, stddev_ms: 1.5 }),
		row({ kernel: "ikj", n: 128, gops: 25, median_ms: 1, stddev_ms: 0.01 }),
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

const acrossFamilies: Row[] = [
	row({ kernel: "ikj", n: 256, gops: 26 }),
	row({ kernel: "ikj", n: 512, gops: 27 }),
	row({ kernel: "rayon-ikj", n: 256, threads: 4, gops: 151 }),
	row({ kernel: "rayon-ikj", n: 512, threads: 4, gops: 174 }),
	row({ kernel: "accelerate-blas", n: 256, gops: 906, backend: "amx" }),
	row({ kernel: "accelerate-blas", n: 512, gops: 1968, backend: "amx" }),
	row({ kernel: "metal-tiled", n: 256, gops: 97, backend: "metal" }),
	row({ kernel: "metal-tiled", n: 512, gops: 268, backend: "metal" }),
	row({ kernel: "mps", n: 512, gops: 699, backend: "metal" }),
];

test("the family chart draws one line per family, in legend order and family ink", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(spec?.color?.domain).toEqual(["serial", "parallel", "amx", "gpu"]);
	expect(spec?.color?.range).toEqual([
		"#844da2",
		"#008300",
		"#3987e5",
		"#e66767",
	]);
});

test("each family point names the kernel that won it", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	const dots = spec?.marks?.[1] as
		| { data: { family: string; n: number; kernel: string }[] }
		| undefined;
	const gpuAt = (n: number) =>
		dots?.data.find((d) => d.family === "gpu" && d.n === n)?.kernel;
	expect(gpuAt(256)).toBe("metal-tiled");
	expect(gpuAt(512)).toBe("mps");
});

test("fastest-per-size cells are filled by family, so every winner has a colour", () => {
	const withUnknown: Row[] = [
		...acrossFamilies,
		row({ kernel: "packed-simd", n: 256, gops: 5000 }),
	];
	const spec = fastestPerSize(withUnknown, f, makeCtx(withUnknown));
	const color = spec?.color as { domain: string[]; range: string[] };
	// packed-simd (serial) wins 256, accelerate-blas (amx) wins 512.
	expect(color.domain).toEqual(["serial", "amx"]);
	expect(color.range).toEqual(["#844da2", "#3987e5"]);
});

test("the CPU & AMX size chart never draws a GPU kernel", () => {
	const spec = throughputVsSize(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(spec?.color?.domain).toEqual(
		expect.arrayContaining(["ikj", "rayon-ikj", "accelerate-blas"]),
	);
	expect(spec?.color?.domain).not.toContain("mps");
	expect(spec?.color?.domain).not.toContain("metal-tiled");
});

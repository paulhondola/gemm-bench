import { expect, test } from "bun:test";
import type { Row } from "../db";
import { legendOf, peak, plotted, pointsOf, row } from "../fixtures";
import { BASELINE_INK, FAMILY_INK } from "../palette";
import {
	canShowSpeedup,
	fastestPerSize,
	optimizationLadder,
	serialOnly,
	throughputByFamily,
	throughputVsSize,
} from "./overview";
import { escapeLabels, type Filters, makeCtx } from "./types";

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
	expect(legendOf(spec).names).toEqual(["naive-ijk"]);
});

test("serialOnly drops the parallel kernels", () => {
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(new Set(plotted(spec).map((p) => p.series))).toEqual(
		new Set(["naive-ijk"]),
	);
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
	const gap = pointsOf(spec, "ikj").find((p) => p.x === 128);
	expect(gap?.y).toBeNull();
	// The band breaks there too: one closed shape per run of sizes, each run
	// followed by the null that separates it from the next.
	const band = spec?.data.find((t) => t.uid === "band_ikj");
	expect(band?.x).toEqual([64, 64, null, 256, 256, null]);
});

test("the relative projection draws no stddev band", () => {
	const spec = throughputVsSize(rows, { ...f, relative: true }, makeCtx(rows));
	expect(spec?.data.some((t) => t.uid?.startsWith("band_"))).toBe(false);
	expect(pointsOf(spec, "rayon-ikj").map((p) => p.y)).toEqual([15, 30]);
});

test("the stddev band stays finite when stddev exceeds the median", () => {
	const noisy: Row[] = [
		row({ kernel: "ikj", n: 64, gops: 20, median_ms: 1, stddev_ms: 1.5 }),
		row({ kernel: "ikj", n: 128, gops: 25, median_ms: 1, stddev_ms: 0.01 }),
	];
	const spec = throughputVsSize(noisy, f, makeCtx(noisy));
	const band = spec?.data.find((t) => t.uid === "band_ikj");
	const edges = ((band?.y ?? []) as (number | null)[]).filter(
		(y) => y !== null,
	);
	expect(edges).toHaveLength(4);
	for (const y of edges) {
		expect(Number.isFinite(y)).toBe(true);
		expect(y).toBeLessThan(100);
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
	expect(legendOf(spec)).toEqual({
		names: ["serial", "parallel", "amx", "gpu"],
		colors: ["#844da2", "#008300", "#3987e5", "#e66767"],
	});
});

test("each family point names the kernel that won it", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	const gpuAt = (n: number) =>
		pointsOf(spec, "gpu").find((p) => p.x === n)?.custom[0];
	expect(gpuAt(256)).toBe("metal-tiled");
	expect(gpuAt(512)).toBe("mps");
});

const familyPeaks = [
	peak({ backend: "cpu", cores: 1, gflops: 100 }),
	peak({ backend: "cpu", cores: 8, gflops: 800 }),
	peak({ backend: "metal", cores: 16, gflops: 5000 }),
];
const withPeaks = makeCtx(acrossFamilies, familyPeaks);

test("the family chart draws a dashed ceiling for serial, parallel and GPU, in family ink and each family's legend group", () => {
	const spec = throughputByFamily(acrossFamilies, f, withPeaks);
	expect(
		spec?.layout.shapes?.map((s) => [
			s.y0,
			s.line?.color,
			s.legendgroup,
			s.label?.text,
		]),
	).toEqual([
		[100, "#844da2", "serial", "1-core peak"],
		[800, "#008300", "parallel", "CPU peak (8 P)"],
		[5000, "#e66767", "gpu", "GPU peak"],
	]);
	// AMX has no published peak, so nothing is drawn in its blue.
	expect(spec?.layout.shapes?.some((s) => s.line?.color === "#3987e5")).toBe(
		false,
	);
});

test("every ceiling is a legend group of a plotted series, so hiding the series hides it", () => {
	const spec = throughputByFamily(acrossFamilies, f, withPeaks);
	const groups = new Set(spec?.data.map((t) => t.legendgroup));
	for (const s of spec?.layout.shapes ?? []) {
		expect(groups.has(s.legendgroup)).toBe(true);
	}
});

test("without peaks the figure has no shapes key at all", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(spec).not.toBeNull();
	expect("shapes" in (spec?.layout ?? {})).toBe(false);
});

test("integer precisions have no ceiling", () => {
	const ints = acrossFamilies.map((r) => ({ ...r, precision: "i32" }));
	const spec = throughputByFamily(
		ints,
		{ ...f, precision: "i32" },
		makeCtx(ints, familyPeaks),
	);
	expect(spec).not.toBeNull();
	expect("shapes" in (spec?.layout ?? {})).toBe(false);
});

test("hover gives each point's share of its own family's ceiling", () => {
	const spec = throughputByFamily(acrossFamilies, f, withPeaks);
	const at = (series: string, n: number) =>
		pointsOf(spec, series).find((p) => p.x === n)?.custom[2];
	expect(at("serial", 256)).toBe(" · 26% of peak");
	// 151 / 800 = 18.875%, to two figures.
	expect(at("parallel", 256)).toBe(" · 19% of peak");
	expect(at("gpu", 512)).toBe(" · 14% of peak");
	expect(spec?.data[0].hovertemplate).toContain("%{customdata[2]}<extra>");
});

test("AMX points carry no percentage", () => {
	const spec = throughputByFamily(acrossFamilies, f, withPeaks);
	expect(pointsOf(spec, "amx").map((p) => p.custom[2])).toEqual(["", ""]);
});

test("a family whose rows span two devices loses its ceiling, and only that family", () => {
	const mixed = acrossFamilies.map((r) =>
		r.kernel === "ikj" && r.n === 512 ? { ...r, device: "Apple M3" } : r,
	);
	const spec = throughputByFamily(mixed, f, makeCtx(mixed, familyPeaks));
	expect(spec?.layout.shapes?.map((s) => s.legendgroup)).toEqual([
		"parallel",
		"gpu",
	]);
	expect(pointsOf(spec, "serial").map((p) => p.custom[2])).toEqual(["", ""]);
	expect(pointsOf(spec, "parallel").map((p) => p.custom[2])).not.toContain("");
});

test("fastest-per-size cells are filled by family, so every winner has a colour", () => {
	const withUnknown: Row[] = [
		...acrossFamilies,
		row({ kernel: "packed-simd", n: 256, gops: 5000 }),
	];
	const spec = fastestPerSize(withUnknown, f, makeCtx(withUnknown));
	// packed-simd (serial) wins 256, accelerate-blas (amx) wins 512.
	expect(legendOf(spec)).toEqual({
		names: ["serial", "amx"],
		colors: ["#844da2", "#3987e5"],
	});
	expect(pointsOf(spec, "serial")).toEqual([
		{ x: "256", y: 1, custom: ["packed-simd", 5000] },
	]);
	// Categorical, in size order: Plotly would read "256" as a number.
	expect(spec?.layout.xaxis?.type).toBe("category");
	expect(spec?.layout.xaxis?.categoryarray).toEqual(["256", "512"]);
	// Stacked bars would otherwise list the legend in reverse.
	expect(spec?.layout.legend?.traceorder).toBe("normal");
});

test("the CPU & AMX size chart never draws a GPU kernel", () => {
	const spec = throughputVsSize(acrossFamilies, f, makeCtx(acrossFamilies));
	const { names } = legendOf(spec);
	expect(names).toEqual(
		expect.arrayContaining(["ikj", "rayon-ikj", "accelerate-blas"]),
	);
	expect(names).not.toContain("mps");
	expect(names).not.toContain("metal-tiled");
});

test("a single kernel plus its band hides the one-entry legend", () => {
	// serialOnly here draws only naive-ijk: one line plus its band, both real
	// traces, but nothing worth a legend for.
	const spec = serialOnly(rows, f, makeCtx(rows));
	expect(spec?.layout.showlegend).toBe(false);
});

test("a kernel named band-<kernel> can't collide with that kernel's band uid", () => {
	const collision: Row[] = [
		row({ kernel: "ikj", n: 64, gops: 20, median_ms: 1, stddev_ms: 0.1 }),
		row({ kernel: "ikj", n: 128, gops: 22, median_ms: 1, stddev_ms: 0.1 }),
		row({ kernel: "band-ikj", n: 64, gops: 10, median_ms: 1, stddev_ms: 0.1 }),
		row({ kernel: "band-ikj", n: 128, gops: 11, median_ms: 1, stddev_ms: 0.1 }),
	];
	const spec = throughputVsSize(collision, f, makeCtx(collision));
	const uids = spec?.data.map((t) => t.uid) ?? [];
	expect(new Set(uids).size).toBe(uids.length);
});

// One row per rung at two sizes, and a parallel kernel at two thread counts.
// At 512 the GPU is slower than AMX, so speed order and effort order differ.
const rungs: Row[] = [
	row({ kernel: "naive-ijk", n: 256, gops: 1 }),
	row({ kernel: "naive-ijk", n: 512, gops: 2 }),
	row({ kernel: "ikj", n: 256, gops: 20 }),
	row({ kernel: "ikj", n: 512, gops: 40 }),
	row({ kernel: "rayon-ikj", n: 256, threads: 4, gops: 60 }),
	row({ kernel: "rayon-ikj", n: 256, threads: 8, gops: 100 }),
	row({ kernel: "rayon-ikj", n: 512, threads: 4, gops: 150 }),
	row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 300 }),
	row({ kernel: "accelerate-blas", n: 256, gops: 1000, backend: "amx" }),
	row({ kernel: "accelerate-blas", n: 512, gops: 2000, backend: "amx" }),
	row({ kernel: "mps", n: 256, gops: 400, backend: "metal" }),
	row({ kernel: "mps", n: 512, gops: 1000, backend: "metal" }),
];

const ladder = (rs: Row[]) => optimizationLadder(rs, f, makeCtx(rs));
const barOf = (rs: Row[]) => ladder(rs)?.data[0];
const labelsOf = (rs: Row[]) => barOf(rs)?.y;

test("the ladder is one horizontal bar trace, rungs in effort order rather than speed order", () => {
	const spec = ladder(rungs);
	expect(spec?.data).toHaveLength(1);
	const bar = spec?.data[0];
	expect(bar?.type).toBe("bar");
	expect(bar?.orientation).toBe("h");
	expect(bar?.name).toBe("ladder");
	expect(bar?.uid).toBe("ladder");
	expect(bar?.y).toEqual(["naive-ijk", "serial", "parallel", "amx", "gpu"]);
	// The GPU rung is slower than AMX and stays below it.
	expect(bar?.x).toEqual([2, 40, 300, 2000, 1000]);
});

test("each rung is its fastest row at N, whatever the thread count, and names it", () => {
	expect(barOf(rungs)?.customdata).toEqual([
		["naive-ijk", 1],
		["ikj", 1],
		["rayon-ikj", 8],
		["accelerate-blas", 1],
		["mps", 1],
	]);
	expect(barOf(rungs)?.hovertemplate).toContain(
		"%{customdata[0]} · %{customdata[1]}T",
	);
});

test("within a rung the fastest kernel wins, and the first row on a tie", () => {
	const contested: Row[] = [
		row({ kernel: "naive-ijk", n: 64, gops: 1 }),
		row({ kernel: "ikj", n: 64, gops: 10 }),
		row({ kernel: "tiled", n: 64, gops: 10 }),
		row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 50 }),
		row({ kernel: "rayon-tiled", n: 64, threads: 4, gops: 80 }),
	];
	expect(barOf(contested)?.customdata).toEqual([
		["naive-ijk", 1],
		["ikj", 1],
		["rayon-tiled", 4],
	]);
});

test("N is the largest size every rung measured", () => {
	// mps has no 512 row, so the ladder drops to 256 rather than skipping the GPU.
	const gpuStopsShort = rungs.filter(
		(r) => !(r.kernel === "mps" && r.n === 512),
	);
	expect(barOf(gpuStopsShort)?.x).toEqual([1, 20, 100, 1000, 400]);
	expect(ladder(gpuStopsShort)?.layout.annotations?.[0].text).toBe(
		"1 → 400 GOP/s · 400× at N = 256",
	);
});

test("bar text names the kernel, its GOP/s and the multiplier over the rung above", () => {
	expect(barOf(rungs)?.text).toEqual([
		"naive-ijk · 2 GOP/s",
		"ikj · 40 GOP/s · ×20",
		"rayon-ikj · 300 GOP/s · ×7.5",
		"accelerate-blas · 2,000 GOP/s · ×6.7",
		// A step below 1 is shown as it is, never reordered.
		"mps · 1,000 GOP/s · ×0.5",
	]);
});

test("the ladder rounds like the headline: 3 figures below 100, thousands separators, 2 figures on ×", () => {
	const headline: Row[] = [
		row({ kernel: "naive-ijk", n: 4096, gops: 0.5241 }),
		row({ kernel: "ikj", n: 4096, gops: 25.68 }),
		row({ kernel: "rayon-ikj", n: 4096, threads: 8, gops: 162.4 }),
		row({ kernel: "accelerate-bnns", n: 4096, gops: 2289.3, backend: "amx" }),
		row({ kernel: "mps", n: 4096, gops: 3436.2, backend: "metal" }),
	];
	expect(barOf(headline)?.text).toEqual([
		"naive-ijk · 0.524 GOP/s",
		"ikj · 25.7 GOP/s · ×49",
		"rayon-ikj · 162 GOP/s · ×6.3",
		"accelerate-bnns · 2,289 GOP/s · ×14",
		"mps · 3,436 GOP/s · ×1.5",
	]);
	expect(ladder(headline)?.layout.annotations?.[0].text).toBe(
		"0.524 → 3,436 GOP/s · 6,600× at N = 4096",
	);
});

test("naive-ijk gets the baseline ink, every other rung its family's", () => {
	expect(barOf(rungs)?.marker?.color).toEqual([
		BASELINE_INK,
		FAMILY_INK.serial,
		FAMILY_INK.parallel,
		FAMILY_INK.amx,
		FAMILY_INK.gpu,
	]);
	expect(barOf(rungs)?.textposition).toBe("outside");
	expect(barOf(rungs)?.cliponaxis).toBe(false);
});

test("naive-ijk is the first rung, never the serial one", () => {
	const onlyNaiveIsSerial = rungs.filter((r) => r.kernel !== "ikj");
	expect(labelsOf(onlyNaiveIsSerial)).toEqual([
		"naive-ijk",
		"parallel",
		"amx",
		"gpu",
	]);
});

test("a rung with no rows is left out: f64 has no GPU, i32 no AMX", () => {
	const noGpu = rungs.filter((r) => r.backend !== "metal");
	expect(labelsOf(noGpu)).toEqual(["naive-ijk", "serial", "parallel", "amx"]);
	const noAmx = rungs.filter((r) => r.backend !== "amx");
	expect(labelsOf(noAmx)).toEqual(["naive-ijk", "serial", "parallel", "gpu"]);
	// The multiplier is over the rung that is actually above, not the missing one.
	expect(barOf(noAmx)?.text?.[3]).toBe("mps · 1,000 GOP/s · ×3.3");
});

test("the ladder is a log GOP/s axis over a reversed category axis in rung order", () => {
	const { layout } = ladder(rungs) ?? {};
	expect(layout?.height).toBe(260);
	expect(layout?.showlegend).toBe(false);
	expect(layout?.hovermode).toBe("closest");
	expect(layout?.xaxis?.type).toBe("log");
	expect(layout?.xaxis?.title).toEqual({ text: "GOP/s" });
	expect(layout?.yaxis).toMatchObject({
		type: "category",
		categoryorder: "array",
		categoryarray: ["naive-ijk", "serial", "parallel", "amx", "gpu"],
		autorange: "reversed",
		fixedrange: true,
	});
});

test("the total is one bold annotation at the top left, with no kernel names", () => {
	const notes = ladder(rungs)?.layout.annotations ?? [];
	expect(notes).toHaveLength(1);
	expect(notes[0]).toMatchObject({
		text: "2 → 1,000 GOP/s · 500× at N = 512",
		xref: "paper",
		yref: "paper",
		x: 0,
		xanchor: "left",
		showarrow: false,
		font: { weight: "bold" },
	});
	// y sits above the plot, where the first bar can't reach it.
	expect(Number(notes[0].y)).toBeGreaterThanOrEqual(1);
});

test("kernel names live only in escaped trace fields, never in the layout", () => {
	const hostile = rungs.map((r) =>
		r.kernel === "ikj" ? { ...r, kernel: "<i>ikj</i>" } : r,
	);
	const spec = ladder(hostile);
	expect(JSON.stringify(spec?.layout)).not.toContain("ikj");
	const escaped = spec ? escapeLabels(spec) : null;
	expect(escaped?.data[0].text?.[1]).toBe(
		"&lt;i&gt;ikj&lt;/i&gt; · 40 GOP/s · ×20",
	);
});

test("the ladder needs two rungs and a size they share, else it hides", () => {
	expect(ladder([])).toBeNull();
	expect(ladder(rungs.filter((r) => r.kernel === "naive-ijk"))).toBeNull();
	// naive-ijk alone in its rung, everything else at another size.
	const apart: Row[] = [
		row({ kernel: "naive-ijk", n: 64, gops: 1 }),
		row({ kernel: "mps", n: 128, gops: 100, backend: "metal" }),
	];
	expect(ladder(apart)).toBeNull();
	// Two serial kernels are still one rung.
	const oneRung: Row[] = [
		row({ kernel: "ikj", n: 64, gops: 10 }),
		row({ kernel: "tiled", n: 64, gops: 12 }),
	];
	expect(ladder(oneRung)).toBeNull();
});

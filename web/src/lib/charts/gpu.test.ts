import { expect, test } from "bun:test";
import type { Row } from "../db";
import { legendOf, plotted, pointsOf, row } from "../fixtures";
import { gpuCopyOverhead, gpuEqualEffort, gpuKernels } from "./gpu";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "mps",
	blockSize: 32,
	relative: false,
};

// GPU rows as withEndToEnd emits them: the plain kernel name, end-to-end
// timings, and the GPU-only median as gpu_ms.
const gpu = (
	kernel: string,
	n: number,
	gops: number,
	median_ms: number,
	gpu_ms: number | null,
) => row({ kernel, n, gops, median_ms, gpu_ms, backend: "metal" });

const f32: Row[] = [
	gpu("metal-naive", 512, 184, 1.458, 1.381),
	gpu("metal-naive", 1024, 303, 7.099, 6.771),
	gpu("metal-tiled", 512, 268, 1.001, 0.829),
	gpu("metal-tiled", 1024, 500, 4.297, 3.976),
	gpu("mps", 512, 699, 0.384, 0.304),
	gpu("mps", 1024, 1675, 1.282, 0.995),
	row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 174 }),
	row({ kernel: "rayon-ikj", n: 1024, threads: 8, gops: 197 }),
	row({ kernel: "accelerate-blas", n: 512, gops: 1968, backend: "amx" }),
	row({ kernel: "accelerate-blas", n: 1024, gops: 1748, backend: "amx" }),
];

test("no GPU chart builds without metal rows", () => {
	const cpu = f32.filter((r) => r.backend !== "metal");
	const ctx = makeCtx(cpu);
	expect(gpuKernels(cpu, f, ctx)).toBeNull();
	expect(gpuEqualEffort(cpu, f, ctx)).toBeNull();
	expect(gpuCopyOverhead(cpu, f, ctx)).toBeNull();
});

test("the kernel chart draws each GPU kernel then both CPU references, in validated order", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	expect(legendOf(spec)).toEqual({
		names: ["metal-naive", "metal-tiled", "mps", "AMX", "parallel CPU"],
		colors: ["#d95926", "#9085e9", "#e66767", "#3987e5", "#008300"],
	});
});

test("a reference point names the CPU kernel and thread count behind it", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	const at512 = (series: string) =>
		pointsOf(spec, series).find((p) => p.x === 512)?.custom[0];
	expect(at512("parallel CPU")).toBe(" · rayon-ikj · 8T");
	expect(at512("mps")).toBe("");
});

test("at an integer precision there is no AMX or mps, leaving three labelled series", () => {
	const i32 = [
		gpu("metal-naive", 512, 172, 1, 0.9),
		gpu("metal-naive", 1024, 317, 1, 0.9),
		gpu("metal-tiled", 512, 292, 1, 0.9),
		gpu("metal-tiled", 1024, 438, 1, 0.9),
		row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 177 }),
		row({ kernel: "rayon-ikj", n: 1024, threads: 8, gops: 205 }),
	].map((r) => ({ ...r, precision: "i32" }));
	const spec = gpuKernels(i32, { ...f, precision: "i32" }, makeCtx(i32));
	expect(legendOf(spec).names).toEqual([
		"metal-naive",
		"metal-tiled",
		"parallel CPU",
	]);
	expect(
		spec?.data.every((t) => "mode" in t && t.mode === "lines+markers+text"),
	).toBe(true);
});

test("a GPU kernel missing a size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		...f32,
		gpu("metal-naive", 2048, 242, 1, 0.9),
		row({ kernel: "rayon-ikj", n: 2048, threads: 8, gops: 152 }),
	];
	const spec = gpuKernels(ragged, f, makeCtx(ragged));
	expect(pointsOf(spec, "mps").find((p) => p.x === 2048)?.y).toBeNull();
});

test("mps is divided by AMX and the shaders by the parallel CPU", () => {
	const spec = gpuEqualEffort(f32, f, makeCtx(f32));
	const at = (kernel: string, n: number) =>
		pointsOf(spec, kernel).find((p) => p.x === n);
	expect(at("mps", 1024)?.custom[0]).toBe("accelerate-blas");
	expect(at("mps", 1024)?.y).toBeCloseTo(1675 / 1748);
	expect(at("metal-tiled", 512)?.custom[0]).toBe("rayon-ikj");
	expect(at("metal-tiled", 512)?.y).toBeCloseTo(268 / 174);
});

test("the ratio chart draws 1.0 as a dashed reference across the whole plot", () => {
	const spec = gpuEqualEffort(f32, f, makeCtx(f32));
	expect(spec?.layout.shapes).toEqual([
		expect.objectContaining({ xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1 }),
	]);
});

test("a size the counterpart never ran contributes no point, never NaN", () => {
	const noAmxAt512 = f32.filter((r) => !(r.backend === "amx" && r.n === 512));
	const spec = gpuEqualEffort(noAmxAt512, f, makeCtx(noAmxAt512));
	expect(pointsOf(spec, "mps").find((p) => p.x === 512)?.y).toBeNull();
	expect(plotted(spec).every((p) => Number.isFinite(p.y))).toBe(true);
});

test("end labels that would overlap on the log axis share one line of text", () => {
	// f32 at N=4096: metal-naive 1.68× and mps 1.60× land a few pixels apart.
	const converging: Row[] = [
		...f32,
		gpu("metal-naive", 4096, 261, 1, 0.99),
		gpu("metal-tiled", 4096, 541, 1, 0.96),
		gpu("mps", 4096, 3558, 1, 0.88),
		row({ kernel: "rayon-ikj", n: 4096, threads: 8, gops: 155 }),
		row({ kernel: "accelerate-blas", n: 4096, gops: 2224, backend: "amx" }),
	];
	const spec = gpuEqualEffort(converging, f, makeCtx(converging));
	const labels = spec?.data.find((t) => t.uid === "labels_");
	expect(labels?.text).toEqual(["mps · metal-naive", "metal-tiled"]);
	expect(labels?.showlegend).toBe(false);
});

test("copy overhead is the share of end-to-end time outside the GPU dispatch", () => {
	const spec = gpuCopyOverhead(f32, f, makeCtx(f32));
	expect(pointsOf(spec, "mps").find((p) => p.x === 512)?.y).toBeCloseTo(
		((0.384 - 0.304) / 0.384) * 100,
	);
});

test("a GPU row without a GPU-only twin is left out of the overhead chart", () => {
	const noTwin = f32.map((r) =>
		r.kernel === "mps" ? { ...r, gpu_ms: null } : r,
	);
	const { names } = legendOf(gpuCopyOverhead(noTwin, f, makeCtx(noTwin)));
	expect(names).not.toContain("mps");
	expect(names).toContain("metal-tiled");
});

test("a single kernel plus its end labels hides the one-entry legend", () => {
	// Only mps and its AMX counterpart survive, so the ratio chart draws one
	// line plus the text-only labels trace — both real, but no legend worth
	// showing for a single kernel.
	const single = f32.filter(
		(r) => r.kernel === "mps" || r.kernel === "accelerate-blas",
	);
	const spec = gpuEqualEffort(single, f, makeCtx(single));
	expect(spec?.layout.showlegend).toBe(false);
});

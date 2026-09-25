import { expect, test } from "bun:test";
import type { Row } from "../db";
import { row } from "../fixtures";
import { gpuCopyOverhead, gpuEqualEffort, gpuKernels, hasGpu } from "./gpu";
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

type Dot = {
	series: string;
	kernel: string;
	counterpart: string;
	n: number;
	gops: number | null;
	ratio: number;
	pct: number;
};
const marksData = (spec: ReturnType<typeof gpuKernels>, i: number) =>
	(spec?.marks?.[i] as { data: Dot[] } | undefined)?.data ?? [];

test("the GPU tab is present only with metal rows", () => {
	expect(hasGpu(f32)).toBe(true);
	expect(hasGpu(f32.filter((r) => r.backend !== "metal"))).toBe(false);
});

test("no GPU chart builds without metal rows", () => {
	const cpu = f32.filter((r) => r.backend !== "metal");
	const ctx = makeCtx(cpu);
	expect(gpuKernels(cpu, f, ctx)).toBeNull();
	expect(gpuEqualEffort(cpu, f, ctx)).toBeNull();
	expect(gpuCopyOverhead(cpu, f, ctx)).toBeNull();
});

test("the kernel chart draws each GPU kernel then both CPU references, in validated order", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	expect(spec?.color?.domain).toEqual([
		"metal-naive",
		"metal-tiled",
		"mps",
		"AMX",
		"parallel CPU",
	]);
	expect(spec?.color?.range).toEqual([
		"#d95926",
		"#9085e9",
		"#e66767",
		"#3987e5",
		"#008300",
	]);
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
	expect(spec?.color?.domain).toEqual([
		"metal-naive",
		"metal-tiled",
		"parallel CPU",
	]);
	// line, dot, direct labels, tip
	expect(spec?.marks).toHaveLength(4);
});

test("a GPU kernel missing a size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		...f32,
		gpu("metal-naive", 2048, 242, 1, 0.9),
		row({ kernel: "rayon-ikj", n: 2048, threads: 8, gops: 152 }),
	];
	const line = marksData(gpuKernels(ragged, f, makeCtx(ragged)), 0);
	expect(line.find((d) => d.series === "mps" && d.n === 2048)?.gops).toBeNull();
});

test("mps is divided by AMX and the shaders by the parallel CPU", () => {
	const dots = marksData(gpuEqualEffort(f32, f, makeCtx(f32)), 2);
	const at = (kernel: string, n: number) =>
		dots.find((d) => d.kernel === kernel && d.n === n);
	expect(at("mps", 1024)?.counterpart).toBe("accelerate-blas");
	expect(at("mps", 1024)?.ratio).toBeCloseTo(1675 / 1748);
	expect(at("metal-tiled", 512)?.counterpart).toBe("rayon-ikj");
	expect(at("metal-tiled", 512)?.ratio).toBeCloseTo(268 / 174);
});

test("a size the counterpart never ran contributes no point, never NaN", () => {
	const noAmxAt512 = f32.filter((r) => !(r.backend === "amx" && r.n === 512));
	const dots = marksData(gpuEqualEffort(noAmxAt512, f, makeCtx(noAmxAt512)), 2);
	expect(dots.some((d) => d.kernel === "mps" && d.n === 512)).toBe(false);
	expect(dots.every((d) => Number.isFinite(d.ratio))).toBe(true);
});

test("copy overhead is the share of end-to-end time outside the GPU dispatch", () => {
	const dots = marksData(gpuCopyOverhead(f32, f, makeCtx(f32)), 1);
	expect(dots.find((d) => d.kernel === "mps" && d.n === 512)?.pct).toBeCloseTo(
		((0.384 - 0.304) / 0.384) * 100,
	);
});

test("a GPU row without a GPU-only twin is left out of the overhead chart", () => {
	const noTwin = f32.map((r) =>
		r.kernel === "mps" ? { ...r, gpu_ms: null } : r,
	);
	const dots = marksData(gpuCopyOverhead(noTwin, f, makeCtx(noTwin)), 1);
	expect(dots.some((d) => d.kernel === "mps")).toBe(false);
	expect(dots.some((d) => d.kernel === "metal-tiled")).toBe(true);
});

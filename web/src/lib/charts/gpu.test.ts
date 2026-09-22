import { expect, test } from "bun:test";
import type { Row } from "../db";
import { gpuRatio, gpuVsCpu, hasGpu } from "./gpu";
import { type Filters, makeCtx } from "./types";

const f: Filters = { precision: "f32", n: 512, kernel: "mps", relative: false };

const rows: Row[] = [
	{
		kernel: "mps",
		precision: "f32",
		n: 256,
		threads: 1,
		gops: 93,
		backend: "metal",
	},
	{
		kernel: "mps",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 738,
		backend: "metal",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 256,
		threads: 4,
		gops: 138,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 512,
		threads: 4,
		gops: 194,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 256,
		threads: 1,
		gops: 30,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 512,
		threads: 1,
		gops: 32,
		backend: "cpu",
	},
];

test("the GPU tab is present only with metal rows", () => {
	expect(hasGpu(rows)).toBe(true);
	expect(hasGpu(rows.filter((r) => r.backend !== "metal"))).toBe(false);
});

test("both GPU charts build from metal plus CPU rows", () => {
	const ctx = makeCtx(rows);
	expect(gpuVsCpu(rows, f, ctx)).not.toBeNull();
	expect(gpuRatio(rows, f, ctx)).not.toBeNull();
});

test("neither GPU chart builds without metal rows", () => {
	const cpu = rows.filter((r) => r.backend !== "metal");
	const ctx = makeCtx(cpu);
	expect(gpuVsCpu(cpu, f, ctx)).toBeNull();
	expect(gpuRatio(cpu, f, ctx)).toBeNull();
});

test("the gpu family gets an explicit gap where it has no row, instead of a line straight through it", () => {
	const ragged: Row[] = [
		{
			kernel: "mps",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 93,
			backend: "metal",
		},
		// mps has no n=512 row; rayon-ikj does, so the union x-axis includes 512.
		{
			kernel: "mps",
			precision: "f32",
			n: 1024,
			threads: 1,
			gops: 900,
			backend: "metal",
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 256,
			threads: 4,
			gops: 138,
			backend: "cpu",
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 512,
			threads: 4,
			gops: 194,
			backend: "cpu",
		},
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 1024,
			threads: 4,
			gops: 250,
			backend: "cpu",
		},
	];
	const spec = gpuVsCpu(ragged, f, makeCtx(ragged));
	expect(spec).not.toBeNull();
	if (!spec) return;
	// marks[0] is the non-gpu Plot.line, marks[1] is the dashed gpu-only
	// Plot.line (split so a constant strokeDasharray can be used — Plot.line
	// draws one <path> per series, so a per-datum dasharray channel is a
	// no-op), confirmed by introspecting spec.marks[i].data for this exact
	// fixture: index 1 carried the gap-filled gpu series (with a null-gops
	// entry at n=512), index 2 the dot mark's real-points-only data, index 3
	// the text labels, index 4 tip.
	const line = spec.marks[1] as {
		data: { family: string; n: number; gops: number | null }[];
	};
	const gap = line.data.find((d) => d.family === "gpu" && d.n === 512);
	expect(gap?.gops).toBeNull();
});

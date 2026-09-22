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

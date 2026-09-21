import { expect, test } from "bun:test";
import type { Row } from "./db";
import {
	allSizes,
	defaultPrecision,
	defaultSize,
	families,
	precisions,
	sizesFor,
} from "./derive";

const rows: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f16",
		n: 64,
		threads: 1,
		gops: 20,
		backend: "cpu",
	},
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});

const mixed: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f32",
		n: 128,
		threads: 1,
		gops: 12,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "rayon-ikj",
		precision: "f32",
		n: 64,
		threads: 4,
		gops: 38,
		backend: "cpu",
	},
	{
		kernel: "mps",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 2,
		backend: "metal",
	},
	{
		kernel: "ikj",
		precision: "i64",
		n: 4096,
		threads: 1,
		gops: 6,
		backend: "cpu",
	},
];

test("family comes from the data, not the kernel name", () => {
	const f = families(mixed);
	expect(f.get("ikj")).toBe("serial");
	expect(f.get("rayon-ikj")).toBe("parallel");
	expect(f.get("mps")).toBe("gpu");
});

test("a metal kernel stays gpu even with only single-thread rows", () => {
	expect(
		families([
			{
				kernel: "mps",
				precision: "f32",
				n: 64,
				threads: 1,
				gops: 2,
				backend: "metal",
			},
		]).get("mps"),
	).toBe("gpu");
});

test("sizesFor narrows to the precision; allSizes does not", () => {
	expect(sizesFor(mixed, "f32")).toEqual([64, 128]);
	expect(sizesFor(mixed, "i64")).toEqual([4096]);
	expect(allSizes(mixed)).toEqual([64, 128, 4096]);
});

test("defaults prefer f32 and the largest size that precision has", () => {
	expect(defaultPrecision(mixed)).toBe("f32");
	expect(defaultSize(mixed, "f32")).toBe(128);
});

test("without f32, the default precision is the one with the widest coverage", () => {
	const noF32 = mixed.filter((r) => r.precision !== "f32");
	expect(defaultPrecision(noF32)).toBe("i64");
});

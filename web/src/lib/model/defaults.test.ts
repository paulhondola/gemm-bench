import { expect, test } from "bun:test";
import { mixed } from "../test/fixtures";
import {
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
} from "./defaults";

test("defaults prefer f32 and the largest size that precision has", () => {
	expect(defaultPrecision(mixed)).toBe("f32");
	expect(defaultSize(mixed, "f32")).toBe(128);
});

test("without f32, the default precision is the one with the widest coverage", () => {
	const noF32 = mixed.filter((r) => r.precision !== "f32");
	expect(defaultPrecision(noF32)).toBe("i64");
});

test("defaultParallelKernel picks the highest-gops parallel kernel at that precision", () => {
	// mixed has one parallel kernel at f32 (rayon-ikj, best row gops 38).
	expect(defaultParallelKernel(mixed, "f32")).toBe("rayon-ikj");
});

test("defaultParallelKernel returns empty when the precision has no parallel kernel", () => {
	// i64 in mixed only has a serial ikj row.
	expect(defaultParallelKernel(mixed, "i64")).toBe("");
});

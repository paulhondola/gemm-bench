import { expect, test } from "bun:test";
import type { Family } from "./derive";
import {
	BASELINE_INK,
	FAMILY_INK,
	FAMILY_ORDER,
	MAX_SERIES,
	paletteFor,
} from "./palette";

const all = [
	"accelerate-blas",
	"accelerate-bnns",
	"ikj",
	"mps",
	"naive-ijk",
	"rayon-ikj",
	"rayon-tiled",
	"static-ikj",
	"static-tiled",
	"tiled",
];
const gpuKernels = ["metal-naive", "metal-tiled", "mps"];
const none = new Map<string, Family>();

test("known kernels take their documented slot", () => {
	const p = paletteFor([...all, ...gpuKernels], none);
	expect(p.get("accelerate-blas")).toBe("#3987e5");
	expect(p.get("ikj")).toBe("#d95926");
	expect(p.get("tiled")).toBe("#199e70");
	expect(p.get("accelerate-bnns")).toBe("#844da2");
	expect(p.get("mps")).toBe("#e66767");
	expect(p.get("metal-naive")).toBe("#d95926");
	expect(p.get("metal-tiled")).toBe("#9085e9");
});

test("the naive-ijk baseline is neutral ink, outside the categorical slots", () => {
	const p = paletteFor(all, none);
	expect(p.get("naive-ijk")).toBe(BASELINE_INK);
	// Ten kernels, ten distinct colours: the baseline frees a slot.
	expect(p.size).toBe(all.length);
	expect(new Set(p.values()).size).toBe(all.length);
});

test("GPU kernels reuse host slots but never collide within their group", () => {
	const p = paletteFor([...all, ...gpuKernels], none);
	expect(p.get("metal-naive")).toBe(p.get("ikj"));
	expect(new Set(gpuKernels.map((k) => p.get(k))).size).toBe(3);
});

test("a survivor keeps its colour when another kernel is filtered out", () => {
	const full = paletteFor(all, none);
	const without = paletteFor(
		all.filter((k) => k !== "accelerate-blas"),
		none,
	);
	expect(without.get("mps")).toBe(full.get("mps"));
	expect(without.get("naive-ijk")).toBe(full.get("naive-ijk"));
	expect(without.has("accelerate-blas")).toBe(false);
});

test("an unknown kernel takes a free slot, never an occupied one", () => {
	const p = paletteFor(
		[...all.filter((k) => k !== "tiled"), "packed-simd"],
		none,
	);
	expect(p.get("packed-simd")).toBe("#199e70");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("an unknown GPU kernel skips the other families' ink", () => {
	const p = paletteFor(
		[...gpuKernels, "metal-simdgroup"],
		new Map<string, Family>([["metal-simdgroup", "gpu"]]),
	);
	// Slots 0 (AMX blue), 5 (parallel green) and 8 (serial purple) are the
	// reference inks drawn beside GPU kernels; slot 1 is metal-naive's. The
	// first free GPU slot is 2.
	expect(p.get("metal-simdgroup")).toBe("#199e70");
});

test("a group that runs out of slots caps rather than generating a hue", () => {
	// mps moved to the GPU group, so the host group has one free slot (red).
	const p = paletteFor([...all, "packed-simd", "packed-simd-2"], none);
	expect(p.get("packed-simd")).toBe("#e66767");
	expect(p.has("packed-simd-2")).toBe(false);
	expect(p.size).toBe(MAX_SERIES + 2); // 9 host + mps + the baseline
});

test("family ink is the all-pairs-validated set, in legend order", () => {
	expect(FAMILY_ORDER).toEqual(["serial", "parallel", "amx", "gpu"]);
	expect(FAMILY_ORDER.map((f) => FAMILY_INK[f])).toEqual([
		"#844da2",
		"#008300",
		"#3987e5",
		"#e66767",
	]);
});

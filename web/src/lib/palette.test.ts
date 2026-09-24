import { expect, test } from "bun:test";
import { BASELINE_INK, MAX_SERIES, paletteFor } from "./palette";

const all = [
	"accelerate",
	"ikj",
	"mps",
	"naive-ijk",
	"rayon-ikj",
	"rayon-tiled",
	"static-ikj",
	"static-tiled",
	"tiled",
];

test("known kernels take their documented slot", () => {
	const p = paletteFor(all);
	expect(p.get("accelerate")).toBe("#3987e5");
	expect(p.get("ikj")).toBe("#d95926");
	expect(p.get("tiled")).toBe("#199e70");
	expect(p.get("mps")).toBe("#e66767");
});

test("the naive-ijk baseline is neutral ink, outside the categorical slots", () => {
	const p = paletteFor(all);
	expect(p.get("naive-ijk")).toBe(BASELINE_INK);
	// Nine kernels, nine distinct colours: the baseline frees a slot.
	expect(p.size).toBe(all.length);
	expect(new Set(p.values()).size).toBe(all.length);
});

test("a survivor keeps its colour when another kernel is filtered out", () => {
	const full = paletteFor(all);
	const without = paletteFor(all.filter((k) => k !== "accelerate"));
	expect(without.get("mps")).toBe(full.get("mps"));
	expect(without.get("naive-ijk")).toBe(full.get("naive-ijk"));
	expect(without.has("accelerate")).toBe(false);
});

test("an unknown kernel takes a free slot, never an occupied one", () => {
	const p = paletteFor([...all.filter((k) => k !== "tiled"), "packed-simd"]);
	expect(p.get("packed-simd")).toBe("#199e70");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("beyond eight slotted kernels the map caps rather than generating a hue", () => {
	const p = paletteFor([...all, "packed-simd"]);
	expect(p.size).toBe(MAX_SERIES + 1); // + the baseline
	expect(p.has("packed-simd")).toBe(false);
	expect(p.get("accelerate")).toBe("#3987e5");
});

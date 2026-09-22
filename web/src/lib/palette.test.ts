import { expect, test } from "bun:test";
import { MAX_SERIES, paletteFor } from "./palette";

const all = [
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
	expect(p.get("naive-ijk")).toBe("#3987e5");
	expect(p.get("ikj")).toBe("#d95926");
	expect(p.get("tiled")).toBe("#199e70");
	expect(p.get("mps")).toBe("#e66767");
});

test("a survivor keeps its colour when another kernel is filtered out", () => {
	const full = paletteFor(all);
	const without = paletteFor(all.filter((k) => k !== "naive-ijk"));
	expect(without.get("mps")).toBe(full.get("mps"));
	expect(without.get("tiled")).toBe(full.get("tiled"));
	expect(without.has("naive-ijk")).toBe(false);
});

test("an unknown kernel takes a free slot, never an occupied one", () => {
	const p = paletteFor([...all.slice(0, 7), "accelerate"]);
	expect(p.get("accelerate")).toBe("#199e70");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("beyond eight kernels the map caps rather than generating a hue", () => {
	const p = paletteFor([...all, "accelerate", "packed-simd"]);
	expect(p.size).toBe(MAX_SERIES);
	expect(p.has("accelerate")).toBe(false);
	expect(p.has("packed-simd")).toBe(false);
	expect(p.get("naive-ijk")).toBe("#3987e5");
});

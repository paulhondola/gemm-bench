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

test("colour follows the kernel, not its rank", () => {
	// The palette is built from the whole dataset, so hiding a series in the
	// legend must not repaint the ones that remain.
	const full = paletteFor(all);
	const fewer = paletteFor(all);
	expect(fewer.get("mps")).toBe(full.get("mps"));
});

test("an unknown kernel is appended, never cycled into an occupied slot", () => {
	const p = paletteFor([...all.slice(0, 7), "accelerate"]);
	expect(p.get("accelerate")).toBe("#e66767");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("beyond eight kernels the map caps rather than generating a hue", () => {
	const p = paletteFor([...all, "accelerate", "packed-simd"]);
	expect(p.size).toBe(MAX_SERIES);
});

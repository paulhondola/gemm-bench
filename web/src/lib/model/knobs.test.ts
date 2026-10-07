import { expect, test } from "bun:test";
import type { Row } from "../data/db";
import { row } from "../test/fixtures";
import {
	knobNames,
	knobValues,
	knobValuesFor,
	pinKnobs,
	singleValueKernels,
} from "./knobs";

const knobRows: Row[] = [
	row({ kernel: "tiled", n: 64, gops: 10, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 128, gops: 12, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 256, gops: 14, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 64, gops: 9, swept: { tile_size: 64 } }),
	row({ kernel: "tiled", n: 128, gops: 11, swept: { tile_size: 64 } }),
	row({ kernel: "packed", n: 64, gops: 30, swept: { depth_block: 256 } }),
	row({ kernel: "ikj", n: 64, gops: 5 }),
];

test("knobNames lists each swept knob once, tile size before depth block", () => {
	expect(knobNames(knobRows)).toEqual(["tile_size", "depth_block"]);
});

test("knobNames puts a knob it has no label for after the known ones, alphabetically", () => {
	const unknown: Row[] = [
		row({ kernel: "x", n: 64, swept: { zeta: 1 } }),
		row({ kernel: "y", n: 64, swept: { alpha: 1, depth_block: 256 } }),
		row({ kernel: "tiled", n: 64, swept: { tile_size: 32 } }),
	];
	expect(knobNames(unknown)).toEqual([
		"tile_size",
		"depth_block",
		"alpha",
		"zeta",
	]);
});

test("knobValues lists one knob's values once, sorted", () => {
	expect(knobValues(knobRows, "tile_size")).toEqual([32, 64]);
	expect(knobValues(knobRows, "depth_block")).toEqual([256]);
});

test("knobValuesFor narrows to the given precision and n", () => {
	expect(knobValuesFor(knobRows, "tile_size", "f32", 64)).toEqual([32, 64]);
	expect(knobValuesFor(knobRows, "tile_size", "f32", 256)).toEqual([32]);
	expect(knobValuesFor(knobRows, "tile_size", "f16", 64)).toEqual([]);
});

test("pinKnobs keeps a pin still measured there and moves a stranded one to the smallest value", () => {
	// Tile 64 is valid at n=128, but n=256 has only 32 (the pickSize scenario).
	expect(pinKnobs(knobRows, "f32", 128, { tile_size: 64 })).toEqual({
		tile_size: 64,
	});
	expect(pinKnobs(knobRows, "f32", 256, { tile_size: 64 })).toEqual({
		tile_size: 32,
	});
	expect(pinKnobs(knobRows, "f32", 64, {})).toEqual({
		depth_block: 256,
		tile_size: 32,
	});
});

test("pinKnobs leaves out a knob with no values at that size", () => {
	expect(pinKnobs(knobRows, "f32", 4096, { tile_size: 32 })).toEqual({});
});

test("singleValueKernels: per knob, the kernels measured at only one value", () => {
	const single = singleValueKernels(knobRows);
	expect(single.get("depth_block")?.has("packed")).toBe(true);
	expect(single.get("tile_size")?.has("tiled")).toBe(false);
	expect([...single.values()].some((kernels) => kernels.has("ikj"))).toBe(
		false,
	);
});

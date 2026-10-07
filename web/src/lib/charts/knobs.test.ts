import { expect, test } from "bun:test";
import type { Row } from "../data/db";
import { legendOf, plotted, pointsOf, row } from "../test/fixtures";
import { knobSweep } from "./knobs";
import { type Filters, makeCtx } from "./spec";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "rayon-ikj",
	knobs: {},
	relative: false,
};
const tileSweep = knobSweep("tile_size");

const rows: Row[] = [
	row({ kernel: "tiled", n: 512, gops: 30, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 512, gops: 50, swept: { tile_size: 64 } }),
	row({
		kernel: "rayon-tiled",
		n: 512,
		threads: 4,
		gops: 20,
		swept: { tile_size: 32 },
	}),
	row({
		kernel: "rayon-tiled",
		n: 512,
		threads: 4,
		gops: 20.1,
		swept: { tile_size: 64 },
	}),
];

test("the sweep builds when a knob has two values", () => {
	expect(tileSweep(rows, f, makeCtx(rows))).not.toBeNull();
});

test("a single value is not a sweep", () => {
	const single = rows.filter((r) => r.swept.tile_size === 32);
	expect(tileSweep(single, f, makeCtx(single))).toBeNull();
});

test("no rows, no chart", () => {
	expect(tileSweep([], f, makeCtx([]))).toBeNull();
});

test("pins n: a row at another size does not leak into the sweep", () => {
	const otherSize = [
		...rows,
		row({ kernel: "tiled", n: 1024, gops: 999, swept: { tile_size: 128 } }),
	];
	const spec = tileSweep(otherSize, f, makeCtx(otherSize));
	expect(spec?.layout.xaxis?.tickvals).toEqual([32, 64]);
	expect(pointsOf(spec, "tiled").some((p) => p.x === 128)).toBe(false);
});

test("takes the best result per (kernel, value), whatever thread count got it", () => {
	const withThreads: Row[] = [
		row({ kernel: "rayon-tiled", n: 512, gops: 10, swept: { tile_size: 32 } }),
		row({
			kernel: "rayon-tiled",
			n: 512,
			threads: 4,
			gops: 90,
			swept: { tile_size: 32 },
		}),
		row({
			kernel: "rayon-tiled",
			n: 512,
			threads: 4,
			gops: 95,
			swept: { tile_size: 64 },
		}),
	];
	const spec = tileSweep(withThreads, f, makeCtx(withThreads));
	expect(pointsOf(spec, "rayon-tiled").find((p) => p.x === 32)?.y).toBe(90);
});

test("a kernel missing a value gets an explicit gap", () => {
	const ragged: Row[] = [
		row({ kernel: "tiled", n: 512, gops: 30, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 512, gops: 50, swept: { tile_size: 64 } }),
		row({ kernel: "rayon-tiled", n: 512, gops: 20, swept: { tile_size: 32 } }),
		// rayon-tiled has tile 64 only at n=1024, so across the dataset it does sweep.
		row({
			kernel: "rayon-tiled",
			n: 1024,
			gops: 22,
			swept: { tile_size: 64 },
		}),
	];
	const spec = tileSweep(ragged, f, makeCtx(ragged));
	expect(pointsOf(spec, "rayon-tiled").find((p) => p.x === 64)?.y).toBeNull();
});

test("a kernel measured at one value is left out, even at a dominant gops", () => {
	const withDominant = [
		...rows,
		row({
			kernel: "static-tiled",
			n: 512,
			threads: 4,
			gops: 660,
			swept: { tile_size: 32 },
		}),
	];
	const spec = tileSweep(withDominant, f, makeCtx(withDominant));
	expect(Math.max(...plotted(spec).map((p) => Number(p.y)))).toBe(50);
	expect(legendOf(spec).names).not.toContain("static-tiled");
});

test("the legend lists only the kernels actually plotted", () => {
	const unplotted = [
		...rows,
		row({
			kernel: "static-tiled",
			n: 1024,
			threads: 4,
			gops: 200,
			swept: { tile_size: 32 },
		}),
	];
	expect(
		legendOf(tileSweep(unplotted, f, makeCtx(unplotted))).names.sort(),
	).toEqual(["rayon-tiled", "tiled"]);
});

test("kernels that don't sweep this knob are never plotted", () => {
	const others = [
		...rows,
		row({ kernel: "packed", n: 512, gops: 80, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 512, gops: 85, swept: { depth_block: 512 } }),
		row({ kernel: "ikj", n: 512, gops: 25 }),
	];
	expect(legendOf(tileSweep(others, f, makeCtx(others))).names.sort()).toEqual([
		"rayon-tiled",
		"tiled",
	]);
});

test("the x-axis is named after the knob", () => {
	const title = (spec: ReturnType<typeof tileSweep>) =>
		(spec?.layout.xaxis?.title as { text?: string })?.text;
	expect(title(tileSweep(rows, f, makeCtx(rows)))).toBe("Tile size");
	const packed = [
		row({ kernel: "packed", n: 512, gops: 80, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 512, gops: 85, swept: { depth_block: 512 } }),
	];
	expect(title(knobSweep("depth_block")(packed, f, makeCtx(packed)))).toBe(
		"Depth block",
	);
});

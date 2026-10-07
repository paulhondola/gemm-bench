import { expect, test } from "bun:test";
import type { Row } from "../data/db";
import { row, threaded } from "../test/fixtures";
import { bestPerFamily, bestPerKernel } from "./best";
import { families } from "./family";

test("bestPerKernel keeps the peak per kernel and size", () => {
	const best = bestPerKernel(threaded);
	expect(best).toHaveLength(2);
	const rayon = best.find((r) => r.kernel === "rayon-ikj");
	expect(rayon?.gops).toBe(38);
	expect(rayon?.threads).toBe(4);
});

test("bestPerKernel keeps serial kernels in frame", () => {
	// The bug this guards: pinning a thread count would drop every kernel
	// that only ever has threads=1 rows.
	expect(
		bestPerKernel(threaded)
			.map((r) => r.kernel)
			.sort(),
	).toEqual(["ikj", "rayon-ikj"]);
});

test("bestPerKernel keeps the first row on a tie", () => {
	const tied: Row[] = [
		row({ kernel: "ikj", n: 64, gops: 10 }),
		row({ kernel: "ikj", n: 64, threads: 2, gops: 10 }),
	];
	expect(bestPerKernel(tied)[0].threads).toBe(1);
});

test("bestPerKernel keeps one row per kernel, precision and size", () => {
	// The Precision tab passes every precision at once: without precision in the
	// key, a kernel's f16 and f32 rows would collapse into whichever is faster.
	const both: Row[] = [
		row({ kernel: "ikj", precision: "f16", n: 64, gops: 20 }),
		row({ kernel: "ikj", precision: "f32", n: 64, gops: 10 }),
		row({ kernel: "ikj", precision: "f32", n: 64, threads: 2, gops: 14 }),
	];
	const best = bestPerKernel(both);
	expect(best.map((r) => `${r.precision}@${r.gops}`).sort()).toEqual([
		"f16@20",
		"f32@14",
	]);
});

test("bestPerKernel returns nothing for no rows", () => {
	expect(bestPerKernel([])).toEqual([]);
});

test("bestPerFamily keeps each family's winning row per precision and size", () => {
	const rows: Row[] = [
		row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 174 }),
		row({ kernel: "rayon-tiled", n: 512, threads: 8, gops: 161 }),
		row({
			kernel: "rayon-tiled",
			precision: "i32",
			n: 512,
			threads: 8,
			gops: 167,
		}),
		row({ kernel: "mps", n: 512, gops: 699, backend: "metal" }),
		row({ kernel: "metal-tiled", n: 512, gops: 268, backend: "metal" }),
	];
	const best = bestPerFamily(rows, families(rows));
	expect(best.map((r) => `${r.kernel}@${r.precision}`).sort()).toEqual([
		"mps@f32",
		"rayon-ikj@f32",
		"rayon-tiled@i32",
	]);
});

import { expect, test } from "bun:test";
import { percentOfPeak } from "../charts/types";
import type { Row } from "../data/db";
import { families } from "../derive";
import { peak, row } from "../test/fixtures";
import { engineRows } from "./engines";

const PEAKS = [
	peak({ cores: 1, gflops: 100 }),
	peak({ cores: 8, gflops: 750 }),
	peak({ backend: "metal", cores: 16, gflops: 5000 }),
];

const rowsFor = (rows: Row[]) => engineRows(rows, PEAKS, families(rows));
const only = (rows: Row[], family: string) =>
	rowsFor(rows).filter((e) => e.family === family);

test("serial pairs the 1-core peak with the best serial row", () => {
	const rows = [
		row({ kernel: "naive-ijk", n: 512, gops: 1 }),
		row({ kernel: "ikj", n: 512, gops: 20 }),
		row({ kernel: "ikj", n: 1024, gops: 25 }),
	];
	const [serial] = only(rows, "serial");
	expect(serial.engine).toBe("1 P-core");
	expect(serial.peak?.cores).toBe(1);
	expect(serial.best?.gops).toBe(25);
});

test("parallel pairs the widest peak with its best row, E-cores and all", () => {
	const rows = [
		row({ kernel: "rayon-ikj", n: 1024, threads: 8, gops: 150 }),
		row({ kernel: "rayon-ikj", n: 1024, threads: 10, gops: 160 }),
	];
	const [parallel] = only(rows, "parallel");
	expect(parallel.engine).toBe("8 P-cores");
	expect(parallel.peak?.gflops).toBe(750);
	expect(parallel.best?.threads).toBe(10);
});

test("AMX has no peak but still reports its best result", () => {
	const rows = [
		row({ kernel: "accelerate-blas", backend: "matrix", n: 1024, gops: 1500 }),
	];
	const [amx] = only(rows, "matrix");
	expect(amx.engine).toBe("Matrix unit");
	expect(amx.peak).toBeUndefined();
	expect(amx.best?.gops).toBe(1500);
});

test("the GPU is labelled by its peak's core count", () => {
	const rows = [row({ kernel: "mps", backend: "metal", n: 4096, gops: 3400 })];
	expect(only(rows, "gpu")[0].engine).toBe("GPU (16 cores)");
});

test("a combination with neither a peak nor a result has no row", () => {
	// The GPU has an f32 peak only, and no f64 rows.
	const rows = [
		row({ kernel: "mps", backend: "metal", n: 4096, gops: 3400 }),
		row({ kernel: "ikj", precision: "f64", n: 512, gops: 10 }),
	];
	const gpu = only(rows, "gpu");
	expect(gpu.map((e) => e.precision)).toEqual(["f32"]);
});

test("a device without peaks still gets its measured rows", () => {
	const rows = [row({ device: "Other CPU", kernel: "ikj", n: 512, gops: 9 })];
	const other = rowsFor(rows).filter((e) => e.device === "Other CPU");
	expect(other).toHaveLength(1);
	expect(other[0].engine).toBe("CPU (1 thread)");
	expect(other[0].peak).toBeUndefined();
	expect(other[0].best?.gops).toBe(9);
});

test("integer precisions are left out", () => {
	const rows = [row({ kernel: "ikj", precision: "i32", n: 512, gops: 30 })];
	expect(rowsFor(rows).some((e) => e.precision === "i32")).toBe(false);
});

test("a tie keeps the first row", () => {
	const rows = [
		row({ kernel: "ikj", n: 512, gops: 20 }),
		row({ kernel: "tiled", n: 512, gops: 20, swept: { tile_size: 64 } }),
	];
	expect(only(rows, "serial")[0].best?.kernel).toBe("ikj");
});

test("rows run in family order, then precision order", () => {
	const rows = [
		row({ kernel: "mps", backend: "metal", precision: "f16", n: 64, gops: 1 }),
		row({ kernel: "ikj", precision: "f64", n: 64, gops: 1 }),
		row({ kernel: "ikj", precision: "f16", n: 64, gops: 1 }),
	];
	const order = rowsFor(rows)
		.filter((e) => e.best)
		.map((e) => `${e.family} ${e.precision}`);
	expect(order).toEqual(["serial f16", "serial f64", "gpu f16"]);
});

test("percent of peak is rounded to 2 significant figures", () => {
	expect(percentOfPeak(197, 777.216)).toBe(25);
	expect(percentOfPeak(3436, 5308.416)).toBe(65);
	expect(percentOfPeak(1050, 1000)).toBe(110);
});

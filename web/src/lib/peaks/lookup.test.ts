import { expect, test } from "bun:test";
import { peak } from "../test/fixtures";
import { familyPeak } from "./lookup";

const M1_PEAKS = [
	peak({ cores: 8, gflops: 777 }),
	peak({ cores: 1, gflops: 103 }),
	peak({ backend: "metal", cores: 16, gflops: 5308 }),
];

test("familyPeak: serial takes the 1-core row, even when the 8-core row is listed first", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M1 Pro", "f32")?.gflops).toBe(
		103,
	);
});

test("familyPeak: parallel takes the widest cpu row", () => {
	const peaks = [
		peak({ cores: 1, gflops: 103 }),
		peak({ cores: 8, gflops: 777 }),
		peak({ cores: 4, gflops: 400 }),
	];
	expect(familyPeak(peaks, "parallel", "Apple M1 Pro", "f32")?.cores).toBe(8);
});

test("familyPeak: parallel gets nothing when the cpu only has a 1-core row", () => {
	// A 1-core ceiling is the serial one; drawing it over a parallel family
	// would make every multi-thread result look like it broke the peak.
	expect(
		familyPeak([peak({ cores: 1 })], "parallel", "Apple M1 Pro", "f32"),
	).toBeUndefined();
});

test("familyPeak: gpu takes the metal row, never a cpu one", () => {
	const found = familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", 16);
	expect(found?.backend).toBe("metal");
	expect(found?.gflops).toBe(5308);
	expect(
		familyPeak([peak({ cores: 8 })], "gpu", "Apple M1 Pro", "f32", 16),
	).toBeUndefined();
});

test("familyPeak: a GPU ceiling needs the run's core count to match", () => {
	// The 14- and 16-core M1 Pro GPUs report the same name.
	expect(
		familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", 14),
	).toBeUndefined();
	expect(
		familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", null),
	).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", 16)?.gflops).toBe(
		5308,
	);
});

test("familyPeak: amx has no peak, even with cpu and metal rows present", () => {
	expect(familyPeak(M1_PEAKS, "matrix", "Apple M1 Pro", "f32")).toBeUndefined();
});

test("familyPeak: another device gets nothing", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M3", "f32")).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M3", "f32", 16)).toBeUndefined();
});

test("familyPeak: an integer precision gets nothing when only f32 rows exist", () => {
	expect(familyPeak(M1_PEAKS, "serial", "Apple M1 Pro", "i32")).toBeUndefined();
	expect(
		familyPeak(M1_PEAKS, "parallel", "Apple M1 Pro", "i32"),
	).toBeUndefined();
	expect(
		familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "i32", 16),
	).toBeUndefined();
});

test("familyPeak: only rows of the asked precision count", () => {
	const peaks = [
		peak({ precision: "f16", cores: 1, gflops: 206 }),
		peak({ precision: "f32", cores: 1, gflops: 103 }),
	];
	expect(familyPeak(peaks, "serial", "Apple M1 Pro", "f16")?.gflops).toBe(206);
});

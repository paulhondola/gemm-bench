import { expect, test } from "bun:test";
import { mixed, row } from "../test/fixtures";
import { families, familyOf } from "./family";

test("family comes from the data, not the kernel name", () => {
	const f = families(mixed);
	expect(f.get("ikj")).toBe("serial");
	expect(f.get("rayon-ikj")).toBe("parallel");
	expect(f.get("mps")).toBe("gpu");
});

test("a metal kernel stays gpu even with only single-thread rows", () => {
	expect(
		families([row({ kernel: "mps", n: 64, gops: 2, backend: "metal" })]).get(
			"mps",
		),
	).toBe("gpu");
});

test("an amx kernel is its own family, not serial, despite threads=1", () => {
	expect(
		families([
			row({ kernel: "accelerate-blas", n: 64, gops: 400, backend: "matrix" }),
		]).get("accelerate-blas"),
	).toBe("matrix");
});

test("familyOf counts a kernel the family map never saw as serial", () => {
	expect(familyOf(row({ kernel: "mystery", n: 64, gops: 1 }), new Map())).toBe(
		"serial",
	);
});

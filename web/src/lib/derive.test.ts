import { expect, test } from "bun:test";
import type { Row } from "./db";
import { precisions } from "./derive";

const rows: Row[] = [
	{
		kernel: "ikj",
		precision: "f32",
		n: 64,
		threads: 1,
		gops: 10,
		backend: "cpu",
	},
	{
		kernel: "ikj",
		precision: "f16",
		n: 64,
		threads: 1,
		gops: 20,
		backend: "cpu",
	},
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});

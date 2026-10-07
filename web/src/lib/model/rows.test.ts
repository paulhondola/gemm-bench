import { expect, test } from "bun:test";
import type { Row } from "../data/db";
import { mixed, row, threaded } from "../test/fixtures";
import { BASELINE_KERNEL } from "./defaults";
import {
	allSizes,
	hasKernel,
	hasSingleThreadBaseline,
	isPlottable,
	partitionPlottable,
	precisions,
	sizesFor,
} from "./rows";

const rows: Row[] = [
	row({ kernel: "ikj", n: 64, gops: 10 }),
	row({ kernel: "ikj", precision: "f16", n: 64, gops: 20 }),
];

test("precisions lists each precision once, sorted", () => {
	expect(precisions(rows)).toEqual(["f16", "f32"]);
});

test("sizesFor narrows to the precision; allSizes does not", () => {
	expect(sizesFor(mixed, "f32")).toEqual([64, 128]);
	expect(sizesFor(mixed, "i64")).toEqual([4096]);
	expect(allSizes(mixed)).toEqual([64, 128, 4096]);
});

const validRow: Row = row({
	kernel: "ikj",
	n: 64,
	gops: 10,
	median_ms: 1,
	stddev_ms: 0.1,
});

test("isPlottable rejects n = 0", () => {
	expect(isPlottable({ ...validRow, n: 0 })).toBe(false);
});

test("isPlottable rejects negative gops", () => {
	expect(isPlottable({ ...validRow, gops: -5 })).toBe(false);
});

test("isPlottable rejects NaN gops", () => {
	expect(isPlottable({ ...validRow, gops: Number.NaN })).toBe(false);
});

test("isPlottable rejects Infinity median_ms", () => {
	expect(
		isPlottable({ ...validRow, median_ms: Number.POSITIVE_INFINITY }),
	).toBe(false);
});

test("isPlottable rejects negative threads", () => {
	expect(isPlottable({ ...validRow, threads: -1 })).toBe(false);
});

test("isPlottable keeps a valid row with stddev_ms = 0", () => {
	// Zero standard deviation is legitimate (a perfectly consistent
	// measurement), not an error condition.
	expect(isPlottable({ ...validRow, stddev_ms: 0 })).toBe(true);
});

test("partitionPlottable reports the usable rows and the dropped count", () => {
	const rows = [validRow, { ...validRow, n: 0 }, { ...validRow, gops: -1 }];
	const { rows: usable, dropped } = partitionPlottable(rows);
	expect(usable).toEqual([validRow]);
	expect(dropped).toBe(2);
});

test("baseline guards detect what a partial sweep is missing", () => {
	expect(hasKernel(threaded, BASELINE_KERNEL)).toBe(false);
	expect(hasSingleThreadBaseline(threaded)).toBe(true);
	expect(hasSingleThreadBaseline(threaded.filter((r) => r.threads !== 1))).toBe(
		false,
	);
});

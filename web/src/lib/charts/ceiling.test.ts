import { expect, test } from "bun:test";
import { peak, row } from "../test/fixtures";
import { type Ceiling, ceilingOf, ceilingShape, pctOfPeak } from "./ceiling";
import { LABEL_INK } from "./layout";
import { makeCtx } from "./spec";

const ceiling: Ceiling = {
	family: "serial",
	gflops: 100,
	label: "1-core peak",
};

test("percent of peak has two significant figures", () => {
	expect(pctOfPeak(24.46, ceiling)).toBe(" · 24% of peak");
	// Rounded to two figures, and never in scientific notation past 100%.
	expect(pctOfPeak(105, ceiling)).toBe(" · 110% of peak");
	expect(pctOfPeak(0.0452, ceiling)).toBe(" · 0.045% of peak");
});

test("no ceiling, no percentage", () => {
	expect(pctOfPeak(26, undefined)).toBe("");
});

test("a ceiling is a dashed rule across the plot, in its family's ink, labelled above its left end", () => {
	const shape = ceilingShape(ceiling);
	expect(shape).toMatchObject({
		type: "line",
		xref: "paper",
		x0: 0,
		x1: 1,
		y0: 100,
		y1: 100,
		line: { color: "#844da2", dash: "dash", width: 1.5 },
		label: {
			text: "1-core peak",
			textposition: "start",
			yanchor: "bottom",
			font: { color: LABEL_INK, size: 11 },
		},
	});
	// Absent, not undefined: the GPU ceiling spans three kernel series and so
	// belongs to no group.
	expect("legendgroup" in shape).toBe(false);
});

test("the GPU label hangs below its line: above the top-most line it would be clipped", () => {
	const shape = ceilingShape({
		family: "gpu",
		gflops: 5308,
		label: "GPU peak",
	});
	expect(shape.line?.color).toBe("#e66767");
	expect(shape.label?.yanchor).toBe("top");
});

test("a ceiling joins the legend group it is given", () => {
	expect(ceilingShape(ceiling, "serial").legendgroup).toBe("serial");
});

const peaks = [
	peak({ backend: "cpu", cores: 1, gflops: 103 }),
	peak({ backend: "cpu", cores: 8, gflops: 777 }),
	peak({ backend: "metal", cores: 16, gflops: 5308 }),
];

const ctx = makeCtx([], peaks);

test("each family's ceiling carries its own label and figure", () => {
	const rows = [row({ kernel: "k", n: 64, gops: 1 })];
	expect(ceilingOf(rows, "serial", ctx)).toEqual({
		family: "serial",
		gflops: 103,
		label: "1-core peak",
	});
	expect(ceilingOf(rows, "parallel", ctx)).toEqual({
		family: "parallel",
		gflops: 777,
		label: "CPU peak (8 P)",
	});
	expect(
		ceilingOf(
			[row({ kernel: "k", n: 64, gops: 1, gpu_cores: 16 })],
			"gpu",
			ctx,
		),
	).toEqual({
		family: "gpu",
		gflops: 5308,
		label: "GPU peak",
	});
});

test("a 14-core GPU gets no ceiling from the 16-core row", () => {
	const rows = [row({ kernel: "k", n: 64, gops: 1, gpu_cores: 14 })];
	expect(ceilingOf(rows, "gpu", ctx)).toBeUndefined();
});

test("AMX, an empty peak list and no rows have no ceiling", () => {
	const rows = [row({ kernel: "k", n: 64, gops: 1 })];
	expect(ceilingOf(rows, "matrix", ctx)).toBeUndefined();
	expect(ceilingOf(rows, "serial", makeCtx([]))).toBeUndefined();
	expect(ceilingOf([], "serial", ctx)).toBeUndefined();
});

test("rows from two devices have no ceiling: neither machine's peak is theirs", () => {
	const rows = [
		row({ kernel: "k", n: 64, gops: 1 }),
		row({ kernel: "k", n: 128, gops: 1, device: "Apple M3" }),
	];
	expect(ceilingOf(rows, "serial", ctx)).toBeUndefined();
});

test("rows from two precisions have no ceiling either", () => {
	const rows = [
		row({ kernel: "k", n: 64, gops: 1 }),
		row({ kernel: "k", n: 64, gops: 1, precision: "f16" }),
	];
	expect(ceilingOf(rows, "serial", ctx)).toBeUndefined();
});

test("a precision with no listed peak has no ceiling", () => {
	const rows = [row({ kernel: "k", n: 64, gops: 1, precision: "i32" })];
	expect(ceilingOf(rows, "serial", ctx)).toBeUndefined();
});

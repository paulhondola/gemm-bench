import { expect, test } from "bun:test";
import { legendOf, peak, pointsOf, row } from "../fixtures";
import {
	type Ceiling,
	ceilingOf,
	ceilingShape,
	escapeLabels,
	type Figure,
	LABEL_INK,
	lineTraces,
	log2Axis,
	makeCtx,
	pctOfPeak,
	type SeriesPoint,
	uidOf,
} from "./types";

const ink = (s: string) => (s === "a" ? "#3987e5" : "#d95926");
const p = (
	series: string,
	x: number,
	y: number,
	custom: (string | number)[] = [],
): SeriesPoint => ({ series, x, y, custom });
const fig = (data: Figure["data"]): Figure => ({ data, layout: {} });

test("a series missing a shared x gets a null y there, where Plotly breaks the line", () => {
	const lines = fig(
		lineTraces(
			[
				p("a", 64, 1),
				p("a", 256, 3),
				p("b", 64, 2),
				p("b", 128, 2),
				p("b", 256, 2),
			],
			{ order: ["a", "b"], color: ink, xs: [64, 128, 256], hovertemplate: "" },
		),
	);
	expect(pointsOf(lines, "a").map((q) => q.y)).toEqual([1, null, 3]);
	expect(pointsOf(lines, "b").map((q) => q.y)).toEqual([2, 2, 2]);
});

test("without shared xs a series is drawn over its own x values, ascending", () => {
	const [a] = lineTraces([p("a", 10, 5), p("a", 1, 1), p("a", 4, 3)], {
		order: ["a"],
		color: ink,
		hovertemplate: "",
	});
	expect(a.x).toEqual([1, 4, 10]);
	expect(a.y).toEqual([1, 3, 5]);
});

test("repeat runs at one x keep the best, not a zig-zag through both", () => {
	const [a] = lineTraces(
		[p("a", 8, 32.4, ["run 1"]), p("a", 8, 129.7, ["run 2"])],
		{
			order: ["a"],
			color: ink,
			hovertemplate: "",
		},
	);
	expect(a.y).toEqual([129.7]);
	expect(a.customdata).toEqual([["run 2"]]);
});

test("traces follow the legend order and carry their series as uid and legend group", () => {
	const lines = fig(
		lineTraces([p("b", 1, 1), p("a", 1, 1)], {
			order: ["a", "b"],
			color: ink,
			hovertemplate: "",
		}),
	);
	expect(legendOf(lines)).toEqual({
		names: ["a", "b"],
		colors: ["#3987e5", "#d95926"],
	});
	expect(lines.data.map((t) => [t.uid, t.legendgroup])).toEqual([
		["a", "a"],
		["b", "b"],
	]);
});

test("direct labels name a series only at the last x, and only where it has a point", () => {
	const [a, b] = lineTraces([p("a", 1, 1), p("a", 2, 2), p("b", 1, 1)], {
		order: ["a", "b"],
		color: ink,
		xs: [1, 2],
		labels: true,
		hovertemplate: "",
	});
	expect(a.mode).toBe("lines+markers+text");
	expect(a.text).toEqual(["", "a"]);
	expect(b.text).toEqual(["", ""]);
});

test("without shared xs, direct labels sit at each series' own last x", () => {
	const [a, b] = lineTraces(
		[p("a", 1, 1), p("a", 3, 2), p("b", 1, 5), p("b", 2, 6)],
		{ order: ["a", "b"], color: ink, labels: true, hovertemplate: "" },
	);
	expect(a.x).toEqual([1, 3]);
	expect(a.text).toEqual(["", "a"]);
	expect(b.x).toEqual([1, 2]);
	expect(b.text).toEqual(["", "b"]);
});

test("the log2 axis ticks exactly the measured sizes, as plain integers", () => {
	const axis = log2Axis([64, 128, 4096], "N");
	expect(axis.type).toBe("log");
	expect(axis.tickvals).toEqual([64, 128, 4096]);
	expect(axis.ticktext).toEqual(["64", "128", "4096"]);
});

test("labels from contributed data render literally, never as Plotly markup", () => {
	const hostile = '<a href="https://x">k</a> & co';
	const safe = '&lt;a href="https://x"&gt;k&lt;/a&gt; &amp; co';
	const out = escapeLabels({
		data: [
			{
				type: "bar",
				name: hostile,
				x: [hostile],
				text: [hostile],
				customdata: [[hostile, 3]],
				hovertemplate: "<b>%{y}</b>",
			},
		],
		layout: { xaxis: { categoryarray: [hostile] } },
	});
	const [t] = out.data;
	expect(t.name).toBe(safe);
	expect(t.x).toEqual([safe]);
	expect(t.text).toEqual([safe]);
	expect(t.customdata).toEqual([[safe, 3]]);
	expect(t.hovertemplate).toBe("<b>%{y}</b>");
	expect(out.layout.xaxis?.categoryarray).toEqual([safe]);
});

test("uids stay valid CSS class names, since Plotly selects by them", () => {
	expect(uidOf("rayon-ikj")).toBe("rayon-ikj");
	expect(uidOf("parallel CPU")).toBe("parallel_20_CPU");
	expect(uidOf("k.v2:x")).toBe("k_2e_v2_3a_x");
	// "_" is encoded too, so a name that looks like an encoding stays distinct.
	expect(uidOf("a_20_b")).not.toBe(uidOf("a b"));
	const [t] = lineTraces([p("parallel CPU", 1, 1)], {
		order: ["parallel CPU"],
		color: ink,
		hovertemplate: "",
	});
	expect(t.uid).toMatch(/^[A-Za-z0-9_-]+$/);
});

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
	expect(ceilingOf(rows, "gpu", ctx)).toEqual({
		family: "gpu",
		gflops: 5308,
		label: "GPU peak",
	});
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

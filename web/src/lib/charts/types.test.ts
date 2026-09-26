import { expect, test } from "bun:test";
import { legendOf, pointsOf } from "../fixtures";
import {
	escapeLabels,
	type Figure,
	lineTraces,
	log2Axis,
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

import type {
	BarData,
	Layout,
	LayoutAxis,
	ScatterData,
} from "plotly.js-dist-min";
import type { Row } from "../db";
import {
	type Family,
	families,
	kernels,
	singleBlockSizeKernels,
} from "../derive";
import { paletteFor } from "../palette";

/** Every chart draws scatter lines or bars. */
export type Trace = Partial<ScatterData> | Partial<BarData>;

/**
 * What a chart hands Plotly: plain JSON, so building and testing a chart never
 * loads the library. Only Chart.svelte imports Plotly at runtime.
 */
export interface Figure {
	data: Trace[];
	layout: Partial<Layout>;
}

export interface Filters {
	precision: string;
	n: number;
	kernel: string;
	blockSize: number;
	/** true renders the chart's relative projection (speedup / ratio). */
	relative: boolean;
}

export interface Ctx {
	palette: Map<string, string>;
	family: Map<string, Family>;
	/** Kernels measured at exactly one block size: the dimension does not vary
	 *  for them, so a block-size selection must not filter them away. */
	singleBlockSize: Set<string>;
}

/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[]): Ctx {
	const family = families(allRows);
	return {
		palette: paletteFor(kernels(allRows), family),
		family,
		singleBlockSize: singleBlockSizeKernels(allRows),
	};
}

/**
 * A chart that cannot be built from these rows returns null. That single
 * convention hides a panel, a projection toggle, and a whole tab.
 */
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => Figure | null;

/** Ticks at the sizes actually measured, not at Plotly's chosen log decades. */
export function log2Ticks(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

/** Axis text and direct labels: text ink, never a series colour. */
export const LABEL_INK = "#9aa1a8";

/** Recessive grid and axis lines, in the panel border's ink. */
export const AXIS: Partial<LayoutAxis> = {
	gridcolor: "#24292e",
	linecolor: "#24292e",
	zeroline: false,
	automargin: true,
};

export const MARGIN = { l: 64, r: 24, t: 8, b: 44 };
/** Room for direct labels beside each series' last point. */
export const LABELLED_MARGIN = { ...MARGIN, r: 100 };

/**
 * Transparent on the panel, the legend in one row above the plot, and one
 * hover readout listing every series at the pointer's x. Charts share these
 * nested objects; Chart.svelte hands Plotly a copy.
 */
export const BASE_LAYOUT: Partial<Layout> = {
	height: 400,
	paper_bgcolor: "rgba(0,0,0,0)",
	plot_bgcolor: "rgba(0,0,0,0)",
	font: {
		family: '"IBM Plex Sans", system-ui, sans-serif',
		size: 12,
		color: LABEL_INK,
	},
	margin: MARGIN,
	legend: {
		orientation: "h",
		x: 0,
		xanchor: "left",
		y: 1.02,
		yanchor: "bottom",
	},
	hovermode: "x unified",
	hoverlabel: {
		bgcolor: "#15181b",
		bordercolor: "#24292e",
		font: { color: "#e6e3dc" },
	},
	xaxis: AXIS,
	yaxis: AXIS,
};

/** A log axis ticked at exactly the measured powers of two, as integers. */
export function log2Axis(ticks: number[], title: string): Partial<LayoutAxis> {
	return {
		...AXIS,
		type: "log",
		tickvals: ticks,
		ticktext: ticks.map(String),
		hoverformat: "d",
		title: { text: title },
	};
}

/**
 * A trace uid for a series name. Plotly builds CSS class selectors from uids
 * (".cb" + uid) when it cleans up a redraw, so "band:ikj", "parallel CPU" or a
 * contributed kernel name with a "." would throw or match the wrong nodes.
 * Every character outside [A-Za-z0-9-], "_" included, becomes _<hex>_, which
 * keeps distinct names distinct.
 */
export function uidOf(series: string): string {
	return series.replace(
		/[^A-Za-z0-9-]/g,
		(c) => `_${c.codePointAt(0)?.toString(16)}_`,
	);
}

export interface SeriesPoint {
	series: string;
	x: number;
	y: number;
	/** Hover fields, read by the chart's hovertemplate as %{customdata[i]}. */
	custom: (string | number)[];
}

export interface LineOptions {
	/** The series to draw, in legend order. */
	order: string[];
	color: (series: string) => string;
	/** Markup lives here, never in data strings: escapeLabels escapes those. */
	hovertemplate: string;
	/**
	 * Shared x positions. A series missing one gets a null y there, which is
	 * where Plotly breaks the line (connectgaps defaults to false) instead of
	 * drawing through a measurement nobody took. Omit it to draw each series
	 * over its own x values.
	 */
	xs?: number[];
	/** Name each series beside its point at the last x. */
	labels?: boolean;
}

/**
 * One lines+markers trace per series. Two points at one (series, x), such as
 * repeat runs, keep the higher y: the rule bestPerKernel applies everywhere
 * else. uid and legendgroup follow the series name, because Plotly matches a
 * hidden series across redraws by uid, and a band in the same legend group
 * hides with its line.
 */
export function lineTraces(
	points: SeriesPoint[],
	o: LineOptions,
): Partial<ScatterData>[] {
	return o.order.map((series): Partial<ScatterData> => {
		const at = new Map<number, SeriesPoint>();
		for (const p of points) {
			if (p.series !== series) continue;
			const current = at.get(p.x);
			if (!current || p.y > current.y) at.set(p.x, p);
		}
		const xs = o.xs ?? [...at.keys()].sort((a, b) => a - b);
		const last = xs[xs.length - 1];
		const color = o.color(series);
		return {
			type: "scatter",
			mode: o.labels ? "lines+markers+text" : "lines+markers",
			name: series,
			uid: uidOf(series),
			legendgroup: series,
			x: xs,
			y: xs.map((x) => at.get(x)?.y ?? null),
			customdata: xs.map((x) => at.get(x)?.custom ?? []),
			hovertemplate: o.hovertemplate,
			line: { color, width: 2 },
			marker: { color, size: 8 },
			// Lets end labels sit in the right margin. Plotly still hides points
			// that fall outside a zoomed range.
			cliponaxis: false,
			...(o.labels
				? {
						text: xs.map((x) => (x === last && at.has(x) ? series : "")),
						textposition: "middle right",
						textfont: { color: LABEL_INK, size: 11 },
					}
				: {}),
		};
	});
}

const escapeText = (s: string) =>
	s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function escapeDeep<T>(v: T): T {
	if (typeof v === "string") return escapeText(v) as T;
	if (Array.isArray(v)) return v.map(escapeDeep) as T;
	return v;
}

/**
 * Plotly renders trace names, text, hover fields and category ticks as a
 * subset of HTML (<b>, <a href>, <span style>). Kernel and precision names
 * come from contributed CSVs, so they are escaped to show literally.
 * Templates are the charts' own and keep their markup.
 */
export function escapeLabels(fig: Figure): Figure {
	const { xaxis } = fig.layout;
	return {
		data: fig.data.map(
			(t) =>
				({
					...t,
					name: escapeDeep(t.name),
					text: escapeDeep(t.text),
					customdata: escapeDeep(t.customdata),
					x: escapeDeep(t.x),
				}) as Trace,
		),
		layout: xaxis
			? {
					...fig.layout,
					xaxis: { ...xaxis, categoryarray: escapeDeep(xaxis.categoryarray) },
				}
			: fig.layout,
	};
}

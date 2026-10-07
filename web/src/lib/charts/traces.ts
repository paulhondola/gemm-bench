import type { ScatterData } from "plotly.js-dist-min";
import { bestBy } from "../model/best";
import { LABEL_INK } from "./layout";

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
 * repeat runs, keep the higher y: bestBy, the rule every "best per" view
 * follows. uid and legendgroup follow the series name, because Plotly matches a
 * hidden series across redraws by uid, and a band in the same legend group
 * hides with its line.
 */
export function lineTraces(
	points: SeriesPoint[],
	o: LineOptions,
): Partial<ScatterData>[] {
	return o.order.map((series): Partial<ScatterData> => {
		const at = bestBy(
			points.filter((p) => p.series === series),
			(p) => p.x,
			(p) => p.y,
		);
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

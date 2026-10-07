import type { Layout, LayoutAxis } from "plotly.js-dist-min";

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

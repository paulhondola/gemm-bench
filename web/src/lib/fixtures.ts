import type { Datum } from "plotly.js-dist-min";
import type { Figure } from "./charts/types";
import type { Row } from "./db";

/** A test row; most rows are single-threaded f32 CPU results. */
export function row(fields: Row): Row {
	return { precision: "f32", threads: 1, backend: "cpu", ...fields };
}

export interface Point {
	x: Datum;
	y: Datum;
	custom: Datum[];
}

/**
 * A series' points in x order, gaps included (y null). Found by name, so a
 * test never depends on where a trace sits in the figure.
 */
export function pointsOf(fig: Figure | null, name: string): Point[] {
	const t = fig?.data.find((d) => d.name === name);
	const x = (t?.x ?? []) as Datum[];
	const y = (t?.y ?? []) as Datum[];
	const custom = (t?.customdata ?? []) as Datum[][];
	return x.map((xi, i) => ({
		x: xi,
		y: y[i] ?? null,
		custom: custom[i] ?? [],
	}));
}

/** The series a figure's legend lists, and the colour each is drawn in. */
export function legendOf(fig: Figure | null): {
	names: string[];
	colors: string[];
} {
	const shown = (fig?.data ?? []).filter((t) => t.showlegend !== false);
	return {
		names: shown.map((t) => String(t.name)),
		colors: shown.map((t) => String(t.marker?.color)),
	};
}

/** Every measured point of every legend series, gaps left out. */
export function plotted(fig: Figure | null): (Point & { series: string })[] {
	return legendOf(fig).names.flatMap((series) =>
		pointsOf(fig, series)
			.filter((p) => p.y !== null)
			.map((p) => ({ ...p, series })),
	);
}

import type { Figure, Trace } from "./spec";

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
 * come from host databases, so they are escaped to show literally.
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

import type { Row } from "../db";
import { hasSingleThreadBaseline } from "../derive";
import { REFERENCE_INK, sequentialRamp } from "../palette";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	type Ctx,
	LABELLED_MARGIN,
	lineTraces,
	type SeriesPoint,
} from "./types";

/** Speedup is relative to one thread, so a 1-thread row must exist. */
export function canShowScaling(rows: Row[]): boolean {
	return hasSingleThreadBaseline(rows);
}

function parallelRows(rows: Row[], ctx: Ctx): Row[] {
	return rows.filter(
		(r) =>
			ctx.family.get(String(r.kernel)) === "parallel" &&
			ctx.palette.has(String(r.kernel)),
	);
}

function singleThread(rows: Row[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const r of rows) {
		if (Number(r.threads) === 1) out.set(String(r.kernel), Number(r.gops));
	}
	return out;
}

export const throughputVsThreads: ChartSpec = (rows, f, ctx) => {
	// The threading tab pins a size: without this, several sizes' rows land on
	// the same x position and the 1-thread baseline below picks an arbitrary one.
	const mine = parallelRows(rows, ctx).filter((r) => Number(r.n) === f.n);
	const counts = new Set(mine.map((r) => Number(r.threads)));
	if (counts.size < 2) return null;

	const relative = f.relative && canShowScaling(mine);
	const base = singleThread(mine);
	const points: SeriesPoint[] = mine
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.threads),
			y: relative
				? Number(r.gops) / (base.get(String(r.kernel)) ?? Number.NaN)
				: Number(r.gops),
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...counts].sort((a, b) => a - b);
	const last = ticks[ticks.length - 1];

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw. ctx.palette is
	// still the hue lookup, so a kernel keeps its colour regardless of who
	// else is present.
	const present = [...new Set(points.map((p) => p.series))];

	return {
		// No shared xs: a kernel swept over fewer thread counts is a shorter
		// sweep, not a missing measurement, so its line is not broken.
		data: lineTraces(points, {
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			labels: true,
			hovertemplate: `<b>%{y:.1f}${relative ? "×" : " GOP/s"}</b>  %{fullData.name}<extra></extra>`,
		}),
		layout: {
			...BASE_LAYOUT,
			// Direct labels need room for the longest kernel name.
			margin: LABELLED_MARGIN,
			// Linear, not log: 8 and 10 really are close, and linear shows the
			// departure from ideal as curvature where log would straighten it.
			xaxis: {
				...AXIS,
				type: "linear",
				tickvals: ticks,
				title: { text: "Threads" },
			},
			yaxis: {
				...AXIS,
				type: "linear",
				title: { text: relative ? "× vs 1 thread" : "GOP/s" },
			},
			// Ideal linear speedup, y = threads: a shape, so no legend entry or hover.
			shapes: relative
				? [
						{
							type: "line",
							x0: ticks[0],
							y0: ticks[0],
							x1: last,
							y1: last,
							line: { color: REFERENCE_INK, dash: "dash", width: 1.5 },
						},
					]
				: [],
		},
	};
};

export const parallelEfficiency: ChartSpec = (rows, f, ctx) => {
	// Scoped to the pinned kernel: without this, each size's line would
	// interleave every parallel kernel's points and jump between thread counts
	// across kernels instead of running monotonically within one.
	const mine = parallelRows(rows, ctx).filter((r) => r.kernel === f.kernel);
	if (!mine.length) return null;
	if (!canShowScaling(mine)) return null;

	// Baseline per (kernel, n) so efficiency compares like with like.
	const base = new Map<string, number>();
	for (const r of mine) {
		if (Number(r.threads) === 1)
			base.set(`${r.kernel}\u0000${r.n}`, Number(r.gops));
	}

	const points: SeriesPoint[] = mine
		.map((r) => ({
			series: String(r.n),
			x: Number(r.threads),
			y:
				(Number(r.gops) /
					(base.get(`${r.kernel}\u0000${r.n}`) ?? Number.NaN) /
					Number(r.threads)) *
				100,
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
	if (ticks.length < 2) return null;

	// Extend rather than clamp: a real result above 100% (cache-locality
	// effects on small problems) must still be visible, not silently capped.
	const ceiling = Math.max(100, ...points.map((p) => p.y));

	// Numeric order, so the ramp runs light (small N) to dark: sorted as
	// strings, "1024" would come before "128".
	const sizes = [...new Set(points.map((p) => p.series))].sort(
		(a, b) => Number(a) - Number(b),
	);
	const ramp = sequentialRamp(sizes.length);

	return {
		data: lineTraces(points, {
			order: sizes,
			color: (n) => ramp[sizes.indexOf(n)],
			hovertemplate: "<b>%{y:.0f}%</b>  N = %{fullData.name}<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			legend: { ...BASE_LAYOUT.legend, title: { text: "N" } },
			xaxis: {
				...AXIS,
				type: "linear",
				tickvals: ticks,
				title: { text: "Threads" },
			},
			yaxis: {
				...AXIS,
				type: "linear",
				range: [0, ceiling],
				title: { text: "% of ideal" },
			},
		},
	};
};

import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { hasSingleThreadBaseline } from "../derive";
import { REFERENCE_INK } from "../palette";
import { BASE, type ChartSpec, type Ctx } from "./types";

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
	const points = mine
		.map((r) => ({
			threads: Number(r.threads),
			kernel: String(r.kernel),
			y: relative
				? Number(r.gops) / (base.get(String(r.kernel)) ?? Number.NaN)
				: Number(r.gops),
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...counts].sort((a, b) => a - b);
	const ideal = ticks.map((t) => ({ threads: t, y: t }));

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw. ctx.palette is
	// still the hue lookup, so a kernel keeps its colour regardless of who
	// else is present.
	const present = [...new Set(points.map((p) => p.kernel))];

	return {
		...BASE,
		// Direct labels below need room for the longest kernel name.
		marginRight: 100,
		// Linear, not log: 8 and 10 really are close, and linear shows the
		// departure from ideal as curvature where log would straighten it.
		x: { type: "linear", ticks, label: "Threads" },
		y: {
			type: "linear",
			label: relative ? "× vs 1 thread" : "GOP/s",
			labelAnchor: "top",
		},
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			...(relative
				? [
						Plot.line(ideal, {
							x: "threads",
							y: "y",
							stroke: REFERENCE_INK,
							strokeDasharray: "5 5",
						}),
					]
				: []),
			Plot.line(points, {
				x: "threads",
				y: "y",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "threads", y: "y", fill: "kernel", r: 4 }),
			Plot.text(
				points.filter((p) => p.threads === ticks[ticks.length - 1]),
				{
					x: "threads",
					y: "y",
					text: "kernel",
					dx: 6,
					textAnchor: "start",
					fill: "#9aa1a8",
					fontSize: 11,
				},
			),
			Plot.tip(
				points,
				Plot.pointer({
					x: "threads",
					y: "y",
					title: (d: { kernel: string; y: number }) =>
						`${d.kernel}\n${d.y.toFixed(1)}`,
				}),
			),
		],
	};
};

export const parallelEfficiency: ChartSpec = (rows, f, ctx) => {
	// Scoped to the pinned kernel: without this, one line per size interleaves
	// every parallel kernel's points (Plot's z defaults to stroke, so a line
	// groups by n alone), and the line jumps thread counts across kernels
	// instead of running monotonically within one.
	const mine = parallelRows(rows, ctx).filter((r) => r.kernel === f.kernel);
	if (!mine.length) return null;
	if (!canShowScaling(mine)) return null;

	// Baseline per (kernel, n) so efficiency compares like with like.
	const base = new Map<string, number>();
	for (const r of mine) {
		if (Number(r.threads) === 1)
			base.set(`${r.kernel}\u0000${r.n}`, Number(r.gops));
	}

	const points = mine
		.map((r) => ({
			threads: Number(r.threads),
			n: String(r.n),
			y:
				(Number(r.gops) /
					(base.get(`${r.kernel}\u0000${r.n}`) ?? Number.NaN) /
					Number(r.threads)) *
				100,
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	const ticks = [...new Set(points.map((p) => p.threads))].sort(
		(a, b) => a - b,
	);
	if (ticks.length < 2) return null;

	// Extend rather than clamp: a real result above 100% (cache-locality
	// effects on small problems) must still be visible, not silently capped.
	const ceiling = Math.max(100, ...points.map((p) => p.y));

	return {
		...BASE,
		x: { type: "linear", ticks, label: "Threads" },
		y: {
			type: "linear",
			domain: [0, ceiling],
			label: "% of ideal",
			labelAnchor: "top",
		},
		// n is ordinal, so a sequential ramp — not the categorical kernel palette.
		color: { type: "ordinal", scheme: "YlGnBu", legend: true, label: "N" },
		marks: [
			Plot.line(points, { x: "threads", y: "y", stroke: "n", strokeWidth: 2 }),
			Plot.dot(points, { x: "threads", y: "y", fill: "n", r: 4 }),
			Plot.tip(
				points,
				Plot.pointer({
					x: "threads",
					y: "y",
					title: (d: { n: string; y: number }) =>
						`N = ${d.n}\n${d.y.toFixed(0)}%`,
				}),
			),
		],
	};
};

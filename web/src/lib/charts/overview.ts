import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { BASELINE_KERNEL, bestPerKernel, hasKernel } from "../derive";
import {
	BASE,
	breakGaps,
	type ChartSpec,
	type Ctx,
	log2Ticks,
	type PlotSpec,
} from "./types";

type SizePoint = {
	n: number;
	kernel: string;
	threads: number;
	lo: number;
	hi: number;
	y: number;
};
type SizeGapPoint = {
	n: number;
	kernel: string;
	threads: null;
	lo: null;
	hi: null;
	y: null;
};

/** Without a naive-ijk row there is no denominator, so the toggle is hidden. */
export function canShowSpeedup(rows: Row[]): boolean {
	return hasKernel(rows, BASELINE_KERNEL);
}

function baselineAt(rows: Row[]): Map<number, number> {
	const out = new Map<number, number>();
	for (const r of rows) {
		if (r.kernel === BASELINE_KERNEL) out.set(Number(r.n), Number(r.gops));
	}
	return out;
}

function sizeSeries(rows: Row[], ctx: Ctx, relative: boolean): PlotSpec | null {
	const best = bestPerKernel(rows).filter((r) =>
		ctx.palette.has(String(r.kernel)),
	);
	const sizes = log2Ticks(best.map((r) => Number(r.n)));
	if (sizes.length < 2) return null;

	const base = baselineAt(best);
	const points = best
		.map((r) => ({
			n: Number(r.n),
			kernel: String(r.kernel),
			threads: Number(r.threads),
			// gops is 2N^3/median_ms, so the band is that value at median±stddev.
			lo:
				Number(r.gops) *
				(Number(r.median_ms) / (Number(r.median_ms) + Number(r.stddev_ms))),
			// Floored at half the median, not near-zero: measured stddev exceeds
			// the median at the smallest sizes, so median-stddev goes negative
			// there. A near-zero floor would blow the upper edge up ~1e9x and
			// destroy the log axis; this is a legibility band, not a confidence
			// interval, so understating spread at the noisiest sizes is fine.
			hi:
				Number(r.gops) *
				(Number(r.median_ms) /
					Math.max(
						Number(r.median_ms) - Number(r.stddev_ms),
						Number(r.median_ms) * 0.5,
					)),
			y: relative
				? Number(r.gops) / (base.get(Number(r.n)) ?? Number.NaN)
				: Number(r.gops),
		}))
		.filter((p) => Number.isFinite(p.y));
	if (!points.length) return null;

	// Plot draws a line/band straight through a size a kernel has no row for;
	// break both instead of implying a measurement nobody took.
	const lineData = breakGaps<SizePoint | SizeGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.kernel,
		(kernel, n) => ({ n, kernel, threads: null, lo: null, hi: null, y: null }),
	);

	return {
		...BASE,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: {
			type: "log",
			label: relative ? "× vs naive-ijk" : "GOP/s",
			labelAnchor: "top",
		},
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
			legend: true,
		},
		marks: [
			...(relative
				? []
				: [
						Plot.areaY(lineData, {
							x: "n",
							y1: "lo",
							y2: "hi",
							fill: "kernel",
							fillOpacity: 0.15,
						}),
					]),
			Plot.line(lineData, {
				x: "n",
				y: "y",
				stroke: "kernel",
				strokeWidth: 2,
				strokeDasharray: (d: { kernel: string }) =>
					d.kernel === "mps" ? "5 4" : undefined,
			}),
			Plot.dot(points, { x: "n", y: "y", fill: "kernel", r: 4 }),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "y",
					title: (d: { kernel: string; threads: number; y: number }) =>
						`${d.kernel} · ${d.threads}T\n${d.y.toFixed(1)}`,
				}),
			),
		],
	};
}

export const throughputVsSize: ChartSpec = (rows, f, ctx) =>
	sizeSeries(rows, ctx, f.relative && canShowSpeedup(rows));

export const serialOnly: ChartSpec = (rows, _f, ctx) =>
	sizeSeries(
		rows.filter((r) => ctx.family.get(String(r.kernel)) === "serial"),
		ctx,
		false,
	);

/**
 * Computed over every kernel, independent of the headline chart's legend —
 * it summarises the data, not the current view.
 */
export const fastestPerSize: ChartSpec = (rows, _f, ctx) => {
	const winners = new Map<number, Row>();
	for (const r of bestPerKernel(rows)) {
		const n = Number(r.n);
		const current = winners.get(n);
		if (!current || Number(r.gops) > Number(current.gops)) winners.set(n, r);
	}
	if (!winners.size) return null;

	const cells = [...winners.entries()].map(([n, r]) => ({
		n,
		kernel: String(r.kernel),
		gops: Number(r.gops),
	}));

	return {
		...BASE,
		height: 120,
		x: { type: "band", label: "N" },
		y: { axis: null },
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
		},
		marks: [
			Plot.cell(cells, { x: "n", fill: "kernel" }),
			Plot.text(cells, {
				x: "n",
				text: (d: { kernel: string; gops: number }) =>
					`${d.kernel}\n${d.gops.toFixed(0)}`,
				fill: "#0e1012",
				fontSize: 11,
			}),
		],
	};
};

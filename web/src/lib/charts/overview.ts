import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import {
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	familyOf,
	hasKernel,
} from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
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

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw. ctx.palette is still
	// the hue lookup, so a kernel keeps its colour regardless of who else is
	// present.
	const present = [...new Set(points.map((p) => p.kernel))];
	// Direct labels in addition to the legend, but only when there are few
	// enough series to read them — the headline chart can carry up to 8.
	const showLabels = present.length <= 4;

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
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: {
			type: "log",
			label: relative ? "× vs naive-ijk" : "GOP/s",
			labelAnchor: "top",
		},
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
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
			}),
			Plot.dot(points, { x: "n", y: "y", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "y",
								text: "kernel",
								dx: 6,
								textAnchor: "start",
								fill: "#9aa1a8",
								fontSize: 11,
							},
						),
					]
				: []),
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

/**
 * Per-kernel view of the host group only. GPU kernels are compared on the
 * GPU tab and folded into the Overview's family lines: a chart never draws
 * kernels from both colour groups.
 */
export const throughputVsSize: ChartSpec = (rows, f, ctx) => {
	const host = rows.filter((r) => familyOf(r, ctx.family) !== "gpu");
	return sizeSeries(host, ctx, f.relative && canShowSpeedup(host));
};

export const serialOnly: ChartSpec = (rows, _f, ctx) =>
	sizeSeries(
		rows.filter((r) => ctx.family.get(String(r.kernel)) === "serial"),
		ctx,
		false,
	);

/**
 * Computed over every kernel, independent of any legend: it summarises the
 * data, not the current view. Filled by the winner's family, not its kernel
 * slot: the winner can come from either colour group, and family ink is the
 * set validated on all pairs, since any two families can end up side by side.
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
		family: familyOf(r, ctx.family),
		gops: Number(r.gops),
	}));
	const present = FAMILY_ORDER.filter((family) =>
		cells.some((c) => c.family === family),
	);

	return {
		...BASE,
		height: 120,
		x: { type: "band", label: "N" },
		y: { axis: null },
		color: {
			domain: present,
			range: present.map((family) => FAMILY_INK[family]),
			legend: true,
		},
		marks: [
			Plot.cell(cells, { x: "n", fill: "family" }),
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

type FamilyPoint = {
	n: number;
	family: string;
	kernel: string;
	threads: number;
	gops: number;
};
type FamilyGapPoint = {
	n: number;
	family: string;
	kernel: null;
	threads: null;
	gops: null;
};

/**
 * One line per family: each family's best kernel, thread count and block size
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const points: FamilyPoint[] = bestPerFamily(rows, ctx.family).map((r) => ({
		n: Number(r.n),
		family: familyOf(r, ctx.family),
		kernel: String(r.kernel),
		threads: Number(r.threads),
		gops: Number(r.gops),
	}));
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// Plot draws a line straight through a size a family has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<FamilyPoint | FamilyGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.family,
		(family, n) => ({ n, family, kernel: null, threads: null, gops: null }),
	);
	const present = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.family === family),
	);

	return {
		...BASE,
		// Direct labels below need room for the longest family name.
		marginRight: 100,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: present,
			range: present.map((family) => FAMILY_INK[family]),
			legend: true,
		},
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "gops",
				stroke: "family",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "family", r: 4 }),
			// At most four series, so direct labels as well as the legend.
			Plot.text(
				points.filter((p) => p.n === sizes[sizes.length - 1]),
				{
					x: "n",
					y: "gops",
					text: "family",
					dx: 6,
					textAnchor: "start",
					fill: "#9aa1a8",
					fontSize: 11,
				},
			),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "gops",
					title: (d: FamilyPoint) =>
						`${d.family} · ${d.kernel} · ${d.threads}T\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

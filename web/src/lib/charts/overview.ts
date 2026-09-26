import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import {
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	type Family,
	familyOf,
	hasKernel,
} from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import {
	AXIS,
	BASE,
	BASE_LAYOUT,
	breakGaps,
	type ChartSpec,
	type Ctx,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
	type PlotChartSpec,
	type PlotSpec,
	type SeriesPoint,
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
export const throughputVsSize: PlotChartSpec = (rows, f, ctx) => {
	const host = rows.filter((r) => familyOf(r, ctx.family) !== "gpu");
	return sizeSeries(host, ctx, f.relative && canShowSpeedup(host));
};

export const serialOnly: PlotChartSpec = (rows, _f, ctx) =>
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
 * One bar trace per family, stacked, so each size is a single full-width
 * cell that the legend can still name and hide by family.
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
		data: present.map((family) => {
			const mine = cells.filter((c) => c.family === family);
			return {
				type: "bar",
				name: family,
				uid: family,
				x: mine.map((c) => String(c.n)),
				y: mine.map(() => 1),
				customdata: mine.map((c) => [c.kernel, c.gops]),
				texttemplate: "%{customdata[0]}<br>%{customdata[1]:.0f}",
				textposition: "inside",
				insidetextanchor: "middle",
				textfont: { color: "#0e1012", size: 11 },
				marker: { color: FAMILY_INK[family] },
				hovertemplate:
					"<b>%{customdata[1]:.0f} GOP/s</b>  %{customdata[0]} · %{fullData.name}<extra></extra>",
			};
		}),
		layout: {
			...BASE_LAYOUT,
			height: 160,
			// Each cell is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			barmode: "stack",
			bargap: 0.02,
			// Plotly reverses a stacked chart's legend by default; keep the
			// validated family order.
			legend: { ...BASE_LAYOUT.legend, traceorder: "normal" },
			xaxis: {
				...AXIS,
				// Sizes are strings here: without "category" Plotly reads "64" as a
				// number and draws a linear axis.
				type: "category",
				categoryorder: "array",
				categoryarray: [...winners.keys()].sort((a, b) => a - b).map(String),
				showgrid: false,
				fixedrange: true,
				title: { text: "N" },
			},
			yaxis: { ...AXIS, visible: false, range: [0, 1], fixedrange: true },
		},
	};
};

/**
 * One line per family: each family's best kernel, thread count and block size
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const points: SeriesPoint[] = bestPerFamily(rows, ctx.family).map((r) => ({
		series: familyOf(r, ctx.family),
		x: Number(r.n),
		y: Number(r.gops),
		custom: [String(r.kernel), Number(r.threads)],
	}));
	const sizes = log2Ticks(points.map((p) => p.x));
	if (sizes.length < 2) return null;

	const present = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.series === family),
	);

	return {
		data: lineTraces(points, {
			order: present,
			color: (family) => FAMILY_INK[family as Family],
			xs: sizes,
			// At most four series, so direct labels as well as the legend.
			labels: true,
			hovertemplate:
				"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]} · %{customdata[1]}T<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			margin: LABELLED_MARGIN,
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
		},
	};
};

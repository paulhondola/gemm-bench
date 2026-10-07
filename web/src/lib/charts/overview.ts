import type { ScatterData } from "plotly.js-dist-min";
import type { Row } from "../data/db";
import { BASELINE_INK, FAMILY_INK, FAMILY_ORDER } from "../design/palette";
import { fmtGops } from "../format/numbers";
import { bestPerFamily, bestPerKernel } from "../model/best";
import { BASELINE_KERNEL } from "../model/defaults";
import { type Family, familyOf } from "../model/family";
import { hasKernel } from "../model/rows";
import { type Ceiling, ceilingOf, ceilingShape, pctOfPeak } from "./ceiling";
import {
	AXIS,
	BASE_LAYOUT,
	LABEL_INK,
	LABELLED_MARGIN,
	log2Axis,
	log2Ticks,
	MARGIN,
} from "./layout";
import type { ChartSpec, Ctx, Figure } from "./spec";
import { lineTraces, type SeriesPoint, uidOf } from "./traces";

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

type SizePoint = SeriesPoint & { lo: number; hi: number };

/**
 * One kernel's ±1 stddev band. fill "toself" closes each null-separated run
 * of consecutive sizes on its own, so the band breaks at a missing size
 * exactly where the line does. It shares the line's legend group, so hiding
 * the kernel hides both.
 */
function band(
	kernel: string,
	color: string,
	sizes: number[],
	points: SizePoint[],
): Partial<ScatterData> {
	const at = new Map(
		points.filter((p) => p.series === kernel).map((p) => [p.x, p]),
	);
	const x: (number | null)[] = [];
	const y: (number | null)[] = [];
	let run: SizePoint[] = [];
	const close = () => {
		if (run.length) {
			const back = [...run].reverse();
			x.push(...run.map((p) => p.x), ...back.map((p) => p.x), null);
			y.push(...run.map((p) => p.hi), ...back.map((p) => p.lo), null);
		}
		run = [];
	};
	for (const n of sizes) {
		const p = at.get(n);
		if (p) run.push(p);
		else close();
	}
	close();
	return {
		type: "scatter",
		mode: "none",
		// "_" (odd count) can never collide with uidOf's own encoding, which
		// always emits an even count of "_" per escaped character.
		uid: `band_${uidOf(kernel)}`,
		legendgroup: kernel,
		showlegend: false,
		hoverinfo: "skip",
		x,
		y,
		fill: "toself",
		// 26 hex is 15% alpha, the old band's fillOpacity.
		fillcolor: `${color}26`,
	};
}

function sizeSeries(rows: Row[], ctx: Ctx, relative: boolean): Figure | null {
	const best = bestPerKernel(rows).filter((r) =>
		ctx.palette.has(String(r.kernel)),
	);
	const sizes = log2Ticks(best.map((r) => Number(r.n)));
	if (sizes.length < 2) return null;

	const base = baselineAt(best);
	const points: SizePoint[] = best
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.n),
			custom: [Number(r.threads)],
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
	const present = [...new Set(points.map((p) => p.series))];
	const color = (kernel: string) => ctx.palette.get(kernel) as string;
	// Direct labels in addition to the legend, but only when there are few
	// enough series to read them — the headline chart can carry up to 8.
	const showLabels = present.length <= 4;
	const unit = relative ? "×" : " GOP/s";

	const lines = lineTraces(points, {
		order: present,
		color,
		xs: sizes,
		labels: showLabels,
		hovertemplate: `<b>%{y:.1f}${unit}</b>  %{fullData.name} · %{customdata[0]}T<extra></extra>`,
	});
	return {
		// Bands first, so every line draws over every band.
		data: relative
			? lines
			: [...present.map((k) => band(k, color(k), sizes, points)), ...lines],
		layout: {
			...BASE_LAYOUT,
			// A band trace carries its own explicit showlegend:false, which Plotly
			// still counts toward its "two or more traces" default, so a single
			// kernel plus its band would otherwise draw a one-entry legend.
			showlegend: present.length > 1,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: {
				...AXIS,
				type: "log",
				title: { text: relative ? "× vs naive-ijk" : "GOP/s" },
			},
		},
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
 * One line per family: each family's best kernel, thread count, tile size and
 * depth block at every size. Metal rows are timed end-to-end, the same host-to-host scope
 * as the CPU rows they are drawn against, so every line is solid. A family
 * with a hardware peak gets a dashed ceiling in its legend group, so hiding
 * the family hides its ceiling.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const best = bestPerFamily(rows, ctx.family);
	const sizes = log2Ticks(best.map((r) => Number(r.n)));
	if (sizes.length < 2) return null;

	const present = FAMILY_ORDER.filter((family) =>
		best.some((r) => familyOf(r, ctx.family) === family),
	);
	const ceilings = new Map<Family, Ceiling>();
	for (const family of present) {
		const c = ceilingOf(
			best.filter((r) => familyOf(r, ctx.family) === family),
			family,
			ctx,
		);
		if (c) ceilings.set(family, c);
	}
	const points: SeriesPoint[] = best.map((r) => {
		const family = familyOf(r, ctx.family);
		return {
			series: family,
			x: Number(r.n),
			y: Number(r.gops),
			custom: [
				String(r.kernel),
				Number(r.threads),
				pctOfPeak(Number(r.gops), ceilings.get(family)),
			],
		};
	});

	return {
		data: lineTraces(points, {
			order: present,
			color: (family) => FAMILY_INK[family as Family],
			xs: sizes,
			// At most four series, so direct labels as well as the legend.
			labels: true,
			hovertemplate:
				"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]} · %{customdata[1]}T%{customdata[2]}<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			margin: LABELLED_MARGIN,
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
			...(ceilings.size
				? {
						shapes: [...ceilings.values()].map((c) =>
							ceilingShape(c, c.family),
						),
					}
				: {}),
		},
	};
};

/**
 * The optimization techniques, in the order a programmer reaches for them:
 * effort order, never sorted by speed, so a rung that buys less than the one
 * above it (the GPU under AMX) shows a step below 1 instead of moving.
 * naive-ijk is its own rung and is not counted in the serial one: it is the
 * baseline every other rung is measured against.
 */
const RUNGS: { label: string; family: Family | null }[] = [
	{ label: BASELINE_KERNEL, family: null },
	{ label: "serial", family: "serial" },
	{ label: "parallel", family: "parallel" },
	{ label: "matrix", family: "matrix" },
	{ label: "gpu", family: "gpu" },
];

/** A multiplier to 2 significant figures: 0.86, 6.3, 49, 6,600. */
const fmtX = (r: number) => Number(r.toPrecision(2)).toLocaleString("en-US");

/**
 * The fastest result of each rung, from naive-ijk to the GPU, and what each
 * step up bought. Every rung is read at one N, the largest every present rung
 * measured, so the bars are comparable: a rung with no rows (f64 has no GPU,
 * the integers no AMX) is left out rather than blocking the rest. The N is
 * derived, not picked, and carried in the annotation with the total.
 *
 * Kernel names appear only in the bar text and customdata, which escapeLabels
 * escapes; the annotation and the y labels are the dashboard's own strings.
 */
export const optimizationLadder: ChartSpec = (rows, _f, ctx) => {
	const rungs = RUNGS.map((rung) => ({
		...rung,
		rows: rows.filter((r) =>
			rung.family === null
				? r.kernel === BASELINE_KERNEL
				: r.kernel !== BASELINE_KERNEL &&
					familyOf(r, ctx.family) === rung.family,
		),
	})).filter((rung) => rung.rows.length);
	if (rungs.length < 2) return null;

	const sizes = rungs.map((rung) => new Set(rung.rows.map((r) => Number(r.n))));
	const shared = [...sizes[0]].filter((n) => sizes.every((s) => s.has(n)));
	if (!shared.length) return null;
	const n = Math.max(...shared);

	// Each rung's rows are one family at one precision (the Overview is scoped
	// to one), so at n bestPerFamily leaves exactly one row: the rung's best.
	const winners = rungs.map(
		(rung) =>
			bestPerFamily(
				rung.rows.filter((r) => Number(r.n) === n),
				ctx.family,
			)[0],
	);
	const gops = winners.map((r) => Number(r.gops));
	const first = gops[0];
	const last = gops[gops.length - 1];

	return {
		data: [
			{
				type: "bar",
				orientation: "h",
				name: "ladder",
				uid: "ladder",
				x: gops,
				y: rungs.map((rung) => rung.label),
				text: winners.map(
					(r, i) =>
						`${r.kernel} · ${fmtGops(gops[i])} GOP/s` +
						(i ? ` · ×${fmtX(gops[i] / gops[i - 1])}` : ""),
				),
				textposition: "outside",
				// Lets the text run into the right margin instead of being cut at the
				// plot edge.
				cliponaxis: false,
				textfont: { color: LABEL_INK, size: 11 },
				customdata: winners.map((r) => [String(r.kernel), Number(r.threads)]),
				marker: {
					color: rungs.map((rung) =>
						rung.family ? FAMILY_INK[rung.family] : BASELINE_INK,
					),
				},
				hovertemplate:
					"<b>%{x:.1f} GOP/s</b>  %{customdata[0]} · %{customdata[1]}T<extra></extra>",
			},
		],
		layout: {
			...BASE_LAYOUT,
			height: 260,
			showlegend: false,
			// Each bar is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			// Right: the outside text of the longest bar. Top: the annotation.
			margin: { ...MARGIN, t: 36, r: 200 },
			xaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
			yaxis: {
				...AXIS,
				type: "category",
				categoryorder: "array",
				categoryarray: rungs.map((rung) => rung.label),
				// Category axes draw bottom to top; the ladder reads top to bottom.
				autorange: "reversed",
				fixedrange: true,
			},
			annotations: [
				{
					text: `${fmtGops(first)} → ${fmtGops(last)} GOP/s · ${fmtX(last / first)}× at N = ${n}`,
					xref: "paper",
					yref: "paper",
					x: 0,
					xanchor: "left",
					y: 1,
					yanchor: "bottom",
					yshift: 8,
					showarrow: false,
					font: { color: LABEL_INK, size: 13, weight: "bold" },
				},
			],
		},
	};
};

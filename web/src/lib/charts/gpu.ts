import type { Row } from "../data/db";
import { bestPerFamily, bestPerKernel } from "../model/best";
import { type Family, familyOf } from "../model/family";
import { FAMILY_INK, REFERENCE_INK } from "../palette";
import { type Ceiling, ceilingOf, ceilingShape, pctOfPeak } from "./ceiling";
import {
	AXIS,
	BASE_LAYOUT,
	LABEL_INK,
	LABELLED_MARGIN,
	log2Axis,
	log2Ticks,
} from "./layout";
import type { ChartSpec, Ctx } from "./spec";
import { lineTraces, type SeriesPoint } from "./traces";

/**
 * The CPU family each GPU kernel is measured against at equal engineering
 * effort: vendor library against vendor library (mps against Accelerate on
 * the matrix unit), hand-written against hand-written (the shaders against the parallel
 * CPU kernels). Nothing in the data marks mps as a vendor library, since every
 * GPU kernel is backend "metal", so like BASELINE_KERNEL this is keyed
 * by name. A Map, not an object literal: kernel names come from host
 * databases, and "constructor" must not resolve to a prototype member.
 */
export const COUNTERPART = new Map<string, Family>([["mps", "matrix"]]);
const counterpartOf = (kernel: string): Family =>
	COUNTERPART.get(kernel) ?? "parallel";

/** The CPU-side reference lines drawn beside the GPU kernels, in legend order. */
const REFERENCES: { family: Family; label: string }[] = [
	{ family: "matrix", label: "Matrix" },
	{ family: "parallel", label: "parallel CPU" },
];

type Point = {
	n: number;
	series: string;
	kernel: string;
	threads: number;
	gops: number;
};

const toPoint = (series: string, r: Row): Point => ({
	n: Number(r.n),
	series,
	kernel: String(r.kernel),
	threads: Number(r.threads),
	gops: Number(r.gops),
});

/** Each GPU kernel's best row at each size; Metal rows are end-to-end. */
function gpuRows(rows: Row[], ctx: Ctx): Row[] {
	return bestPerKernel(rows).filter(
		(r) =>
			familyOf(r, ctx.family) === "gpu" && ctx.palette.has(String(r.kernel)),
	);
}

const toKernelPoint = (r: Row): Point => toPoint(String(r.kernel), r);

const gpuPoints = (rows: Row[], ctx: Ctx): Point[] =>
	gpuRows(rows, ctx).map(toKernelPoint);

/** A family's best row at each size, keyed by n. */
function familyBest(rows: Row[], ctx: Ctx, family: Family): Map<number, Row> {
	return new Map(
		bestPerFamily(rows, ctx.family)
			.filter((r) => familyOf(r, ctx.family) === family)
			.map((r): [number, Row] => [Number(r.n), r]),
	);
}

/**
 * Each GPU kernel against the best parallel-CPU and the matrix unit result at every size.
 * GPU rows carry end-to-end timings, the same host-to-host scope as the CPU
 * rows, so every line is solid. The GPU ceiling spans three kernel series and
 * so belongs to no legend group; the parallel one shares its reference's, so
 * hiding that line hides its ceiling. Each point's hover is measured against
 * its own series' ceiling.
 */
export const gpuKernels: ChartSpec = (rows, _f, ctx) => {
	const kernelRows = gpuRows(rows, ctx);
	const kernelPoints = kernelRows.map(toKernelPoint);
	if (!kernelPoints.length) return null;
	const referenceRows = REFERENCES.map((reference) => ({
		...reference,
		best: [...familyBest(rows, ctx, reference.family).values()],
	}));
	const referencePoints = referenceRows.flatMap(({ label, best }) =>
		best.map((r) => toPoint(label, r)),
	);
	const points = [...kernelPoints, ...referencePoints];
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// The validated legend order: GPU kernels (metal-naive, metal-simdgroup,
	// metal-tiled, mps sort that way), then the references.
	const kernels = [...new Set(kernelPoints.map((p) => p.series))].sort();
	const references = referenceRows.filter(({ label }) =>
		referencePoints.some((p) => p.series === label),
	);
	const ink = new Map([
		...kernels.map((k) => [k, ctx.palette.get(k) as string] as const),
		...references.map((r) => [r.label, FAMILY_INK[r.family]] as const),
	]);
	const order = [...ink.keys()];
	const showLabels = order.length <= 4;

	const gpuCeiling = ceilingOf(kernelRows, "gpu", ctx);
	const ceilings = new Map<string, Ceiling | undefined>([
		...kernels.map((k) => [k, gpuCeiling] as const),
		...references.map(
			(r) => [r.label, ceilingOf(r.best, r.family, ctx)] as const,
		),
	]);
	const shapes = [
		...(gpuCeiling ? [ceilingShape(gpuCeiling)] : []),
		...references.flatMap((r) => {
			const c = ceilings.get(r.label);
			return c ? [ceilingShape(c, r.label)] : [];
		}),
	];

	return {
		data: lineTraces(
			points.map((p) => ({
				series: p.series,
				x: p.n,
				y: p.gops,
				custom: [
					// A reference line names the kernel and thread count behind each
					// point; a GPU kernel's own line already is that kernel.
					p.series === p.kernel ? "" : ` · ${p.kernel} · ${p.threads}T`,
					pctOfPeak(p.gops, ceilings.get(p.series)),
				],
			})),
			{
				order,
				color: (s) => ink.get(s) as string,
				xs: sizes,
				labels: showLabels,
				hovertemplate:
					"<b>%{y:.1f} GOP/s</b>  %{fullData.name}%{customdata[0]}%{customdata[1]}<extra></extra>",
			},
		),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
			...(shapes.length ? { shapes } : {}),
		},
	};
};

type RatioPoint = {
	n: number;
	kernel: string;
	counterpart: string;
	threads: number;
	ratio: number;
};

/**
 * Each GPU kernel divided by the best row of its COUNTERPART family at the
 * same size: where the GPU wins for the same engineering effort.
 */
export const gpuEqualEffort: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	const best = new Map(
		[...new Set(kernelPoints.map((p) => counterpartOf(p.kernel)))].map(
			(family) => [family, familyBest(rows, ctx, family)] as const,
		),
	);
	const points: RatioPoint[] = kernelPoints.flatMap((p) => {
		const cpu = best.get(counterpartOf(p.kernel))?.get(p.n);
		// A size the counterpart never ran is a gap, never a NaN point.
		if (!cpu) return [];
		const ratio = p.gops / Number(cpu.gops);
		if (!Number.isFinite(ratio)) return [];
		return [
			{
				n: p.n,
				kernel: p.kernel,
				counterpart: String(cpu.kernel),
				threads: Number(cpu.threads),
				ratio,
			},
		];
	});
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.kernel))].sort();
	const showLabels = present.length <= 4;

	// Ratios of different kernels converge (f32 N=4096: metal-naive 1.68×,
	// mps 1.60×), so end labels closer than LABEL_GAP× share one line of text
	// instead of printing over each other.
	// ponytail: a fixed gap assumes the axis spans ~2–3 decades, as it does on
	// this data; derive it from the scale if labels collide again.
	const LABEL_GAP = 1.25;
	const labels: { n: number; ratio: number; text: string }[] = [];
	const ends = points
		.filter((p) => p.n === sizes[sizes.length - 1])
		.sort((a, b) => a.ratio - b.ratio);
	for (const p of ends) {
		const below = labels.at(-1);
		if (below && p.ratio / below.ratio < LABEL_GAP) {
			below.text += ` · ${p.kernel}`;
		} else {
			labels.push({ n: p.n, ratio: p.ratio, text: p.kernel });
		}
	}

	const lines = lineTraces(
		points.map(
			(p): SeriesPoint => ({
				series: p.kernel,
				x: p.n,
				y: p.ratio,
				custom: [p.counterpart, p.threads],
			}),
		),
		{
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			xs: sizes,
			hovertemplate:
				"<b>%{y:.2f}×</b>  %{fullData.name} ÷ %{customdata[0]} · %{customdata[1]}T<extra></extra>",
		},
	);

	return {
		data: [
			...lines,
			// The end labels ride in their own text-only trace: a merged label
			// names two kernels, so it cannot belong to either one's line.
			...(showLabels
				? [
						{
							type: "scatter" as const,
							mode: "text",
							// "_" (odd count) can never collide with uidOf's own encoding,
							// which always emits an even count of "_" per escaped character.
							uid: "labels_",
							showlegend: false,
							hoverinfo: "skip" as const,
							cliponaxis: false,
							x: labels.map((l) => l.n),
							y: labels.map((l) => l.ratio),
							text: labels.map((l) => l.text),
							textposition: "middle right" as const,
							textfont: { color: LABEL_INK, size: 11 },
						},
					]
				: []),
		],
		layout: {
			...BASE_LAYOUT,
			// A single kernel's line plus the text-only labels trace (its own
			// showlegend:false) still counts as two traces to Plotly's default, so
			// it would otherwise draw a one-entry legend.
			showlegend: present.length > 1,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: {
				...AXIS,
				type: "log",
				// Plain numbers: 0.4, never 400m.
				tickformat: "~g",
				title: { text: "× vs CPU at equal effort" },
			},
			// Ratio 1.0, where the GPU starts to win: a shape, so no legend entry
			// or hover. Shape y is in data units even on a log axis.
			shapes: [
				{
					type: "line",
					xref: "paper",
					x0: 0,
					x1: 1,
					y0: 1,
					y1: 1,
					line: { color: REFERENCE_INK, dash: "dash", width: 1.5 },
				},
			],
		},
	};
};

/**
 * The share of end-to-end time spent outside the GPU dispatch: copying the
 * inputs in, encoding, and copying the result out. Copies grow as N² and
 * arithmetic as N³, so the share falls at large sizes.
 */
export const gpuCopyOverhead: ChartSpec = (rows, _f, ctx) => {
	// The same best-per-(kernel, n) rows the kernel chart plots. Only Metal
	// rows carry gpu_ms; a row without it has nothing to subtract, so it is
	// skipped.
	const points: SeriesPoint[] = bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" &&
				r.gpu_ms != null &&
				ctx.palette.has(String(r.kernel)),
		)
		.map((r) => ({
			series: String(r.kernel),
			x: Number(r.n),
			y: ((Number(r.median_ms) - Number(r.gpu_ms)) / Number(r.median_ms)) * 100,
			custom: [],
		}))
		.filter((p) => Number.isFinite(p.y));
	const sizes = log2Ticks(points.map((p) => p.x));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.series))].sort();
	const showLabels = present.length <= 4;

	return {
		data: lineTraces(points, {
			order: present,
			color: (k) => ctx.palette.get(k) as string,
			xs: sizes,
			labels: showLabels,
			hovertemplate:
				"<b>%{y:.1f}%</b> copies + encoding  %{fullData.name}<extra></extra>",
		}),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			// Includes 0 so the share reads against a true baseline, but is never
			// clamped there: a negative share in contributed data stays visible.
			yaxis: {
				...AXIS,
				type: "linear",
				rangemode: "tozero",
				title: { text: "% of end-to-end time" },
			},
		},
	};
};

import type { Row } from "../db";
import { bestPerFamily, bestPerKernel, type Family, familyOf } from "../derive";
import { FAMILY_INK, REFERENCE_INK } from "../palette";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	type Ctx,
	LABEL_INK,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
	type SeriesPoint,
} from "./types";

/**
 * The CPU family each GPU kernel is measured against at equal engineering
 * effort: vendor library against vendor library (mps against Accelerate on
 * AMX), hand-written against hand-written (the shaders against the parallel
 * CPU kernels). Nothing in the data marks mps as a vendor library, since all
 * three GPU kernels are backend "metal", so like BASELINE_KERNEL this is keyed
 * by name. A Map, not an object literal: kernel names come from contributed
 * CSVs, and "constructor" must not resolve to a prototype member.
 */
export const COUNTERPART = new Map<string, Family>([["mps", "amx"]]);
const counterpartOf = (kernel: string): Family =>
	COUNTERPART.get(kernel) ?? "parallel";

/** The CPU-side reference lines drawn beside the GPU kernels, in legend order. */
const REFERENCES: { family: Family; label: string }[] = [
	{ family: "amx", label: "AMX" },
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

/** Each GPU kernel's best row at each size; rows are end-to-end (withEndToEnd). */
function gpuPoints(rows: Row[], ctx: Ctx): Point[] {
	return bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" && ctx.palette.has(String(r.kernel)),
		)
		.map((r) => toPoint(String(r.kernel), r));
}

/** A family's best row at each size, keyed by n. */
function familyBest(rows: Row[], ctx: Ctx, family: Family): Map<number, Row> {
	return new Map(
		bestPerFamily(rows, ctx.family)
			.filter((r) => familyOf(r, ctx.family) === family)
			.map((r): [number, Row] => [Number(r.n), r]),
	);
}

/**
 * Each GPU kernel against the best parallel-CPU and AMX result at every size.
 * GPU rows carry end-to-end timings, the same host-to-host scope as the CPU
 * rows, so every line is solid.
 */
export const gpuKernels: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	if (!kernelPoints.length) return null;
	const referencePoints = REFERENCES.flatMap(({ family, label }) =>
		[...familyBest(rows, ctx, family).values()].map((r) => toPoint(label, r)),
	);
	const points = [...kernelPoints, ...referencePoints];
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// The validated legend order: GPU kernels (metal-naive, metal-tiled, mps
	// sort that way), then the references.
	const kernels = [...new Set(kernelPoints.map((p) => p.series))].sort();
	const references = REFERENCES.filter(({ label }) =>
		referencePoints.some((p) => p.series === label),
	);
	const ink = new Map([
		...kernels.map((k) => [k, ctx.palette.get(k) as string] as const),
		...references.map((r) => [r.label, FAMILY_INK[r.family]] as const),
	]);
	const order = [...ink.keys()];
	const showLabels = order.length <= 4;

	return {
		data: lineTraces(
			points.map((p) => ({
				series: p.series,
				x: p.n,
				y: p.gops,
				// A reference line names the kernel and thread count behind each
				// point; a GPU kernel's own line already is that kernel.
				custom: [p.series === p.kernel ? "" : ` · ${p.kernel} · ${p.threads}T`],
			})),
			{
				order,
				color: (s) => ink.get(s) as string,
				xs: sizes,
				labels: showLabels,
				hovertemplate:
					"<b>%{y:.1f} GOP/s</b>  %{fullData.name}%{customdata[0]}<extra></extra>",
			},
		),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "N"),
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
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
	// The same best-per-(kernel, n) rows the kernel chart plots. A row with no
	// GPU-only twin (gpu_ms null) has nothing to subtract, so it is skipped.
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

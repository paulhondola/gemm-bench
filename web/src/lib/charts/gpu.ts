import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { bestPerFamily, bestPerKernel, type Family, familyOf } from "../derive";
import { FAMILY_INK, REFERENCE_INK } from "../palette";
import { BASE, breakGaps, type ChartSpec, type Ctx, log2Ticks } from "./types";

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
type GapPoint = {
	n: number;
	series: string;
	kernel: null;
	threads: null;
	gops: null;
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
	const present = [...kernels, ...references.map((r) => r.label)];
	const range = [
		...kernels.map((k) => ctx.palette.get(k) as string),
		...references.map((r) => FAMILY_INK[r.family]),
	];
	const showLabels = present.length <= 4;

	// Plot draws a line straight through a size a series has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<Point | GapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.series,
		(series, n) => ({ n, series, kernel: null, threads: null, gops: null }),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: { domain: present, range, legend: true },
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "gops",
				stroke: "series",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "series", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "gops",
								text: "series",
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
					y: "gops",
					title: (d: Point) =>
						d.series === d.kernel
							? `${d.kernel}\n${d.gops.toFixed(1)} GOP/s`
							: `${d.series}: ${d.kernel} · ${d.threads}T\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

type RatioPoint = {
	n: number;
	kernel: string;
	counterpart: string;
	threads: number;
	ratio: number;
};
type RatioGapPoint = {
	n: number;
	kernel: string;
	counterpart: null;
	threads: null;
	ratio: null;
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

	const lineData = breakGaps<RatioPoint | RatioGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.kernel,
		(kernel, n) => ({
			n,
			kernel,
			counterpart: null,
			threads: null,
			ratio: null,
		}),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: {
			type: "log",
			// Plain numbers: Plot's default SI format prints 0.4 as "400m".
			tickFormat: "~g",
			label: "× vs CPU at equal effort",
			labelAnchor: "top",
		},
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			Plot.ruleY([1], { stroke: REFERENCE_INK, strokeDasharray: "5 5" }),
			Plot.line(lineData, {
				x: "n",
				y: "ratio",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "ratio", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(labels, {
							x: "n",
							y: "ratio",
							text: "text",
							dx: 6,
							textAnchor: "start",
							fill: "#9aa1a8",
							fontSize: 11,
						}),
					]
				: []),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "ratio",
					title: (d: RatioPoint) =>
						`${d.kernel} ÷ ${d.counterpart} · ${d.threads}T\n${d.ratio.toFixed(2)}×`,
				}),
			),
		],
	};
};

type OverheadPoint = { n: number; kernel: string; pct: number };
type OverheadGapPoint = { n: number; kernel: string; pct: null };

/**
 * The share of end-to-end time spent outside the GPU dispatch: copying the
 * inputs in, encoding, and copying the result out. Copies grow as N² and
 * arithmetic as N³, so the share falls at large sizes.
 */
export const gpuCopyOverhead: ChartSpec = (rows, _f, ctx) => {
	// The same best-per-(kernel, n) rows the kernel chart plots. A row with no
	// GPU-only twin (gpu_ms null) has nothing to subtract, so it is skipped.
	const points: OverheadPoint[] = bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" &&
				r.gpu_ms != null &&
				ctx.palette.has(String(r.kernel)),
		)
		.map((r) => ({
			n: Number(r.n),
			kernel: String(r.kernel),
			pct:
				((Number(r.median_ms) - Number(r.gpu_ms)) / Number(r.median_ms)) * 100,
		}))
		.filter((p) => Number.isFinite(p.pct));
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.kernel))].sort();
	const showLabels = present.length <= 4;
	const lineData = breakGaps<OverheadPoint | OverheadGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.kernel,
		(kernel, n) => ({ n, kernel, pct: null }),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		// Includes 0 so the share reads against a true baseline, but is never
		// clamped there: a negative share in contributed data stays visible.
		y: {
			type: "linear",
			zero: true,
			label: "% of end-to-end time",
			labelAnchor: "top",
		},
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "pct",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "pct", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "pct",
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
					y: "pct",
					title: (d: OverheadPoint) =>
						`${d.kernel}\n${d.pct.toFixed(1)}% copies + encoding`,
				}),
			),
		],
	};
};

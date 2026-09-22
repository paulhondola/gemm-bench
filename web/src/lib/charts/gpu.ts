import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import { bestPerKernel } from "../derive";
import { REFERENCE_INK } from "../palette";
import { BASE, breakGaps, type ChartSpec, type Ctx, log2Ticks } from "./types";

export function hasGpu(rows: Row[]): boolean {
	return rows.some((r) => r.backend === "metal");
}

type FamilyPoint = { n: number; family: string; gops: number };
type FamilyGapPoint = { n: number; family: string; gops: null };

/** Best gpu / parallel / serial result at each size — one line per family. */
function byFamily(rows: Row[], ctx: Ctx): FamilyPoint[] {
	const out = new Map<string, { n: number; family: string; gops: number }>();
	for (const r of bestPerKernel(rows)) {
		const family = ctx.family.get(String(r.kernel)) ?? "serial";
		const key = `${family}\u0000${r.n}`;
		const current = out.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops)
			out.set(key, { n: Number(r.n), family, gops });
	}
	return [...out.values()];
}

const FAMILY_INK = {
	gpu: "#e66767",
	parallel: "#c98500",
	serial: "#199e70",
} as const;

export const gpuVsCpu: ChartSpec = (rows, _f, ctx) => {
	if (!hasGpu(rows)) return null;
	const points = byFamily(rows, ctx);
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// Plot draws a line straight through a size a family has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<FamilyPoint | FamilyGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.family,
		(family, n) => ({ n, family, gops: null }),
	);
	// Plot.line draws one <path> per series (grouped by z, which defaults to
	// stroke), so a per-datum strokeDasharray channel cannot vary along that
	// one path — it silently does nothing. Split into two marks instead: gpu
	// dashed at a constant dasharray, everything else solid.
	const otherLine = lineData.filter((p) => p.family !== "gpu");
	const gpuLine = lineData.filter((p) => p.family === "gpu");

	return {
		...BASE,
		// Direct labels below need room for the longest family/kernel name.
		marginRight: 100,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: Object.keys(FAMILY_INK),
			range: Object.values(FAMILY_INK),
			legend: true,
		},
		marks: [
			Plot.line(otherLine, {
				x: "n",
				y: "gops",
				stroke: "family",
				strokeWidth: 2,
			}),
			// Dashed because the mps timed region is commit -> waitUntilCompleted
			// only: buffer copies and encoding are excluded.
			Plot.line(gpuLine, {
				x: "n",
				y: "gops",
				stroke: "family",
				strokeWidth: 2,
				strokeDasharray: "5 4",
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "family", r: 4 }),
			// Three series, so direct labels as well as the legend.
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
					title: (d: { family: string; gops: number }) =>
						`${d.family}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

export const gpuRatio: ChartSpec = (rows, _f, ctx) => {
	if (!hasGpu(rows)) return null;
	const points = byFamily(rows, ctx);
	const gpu = new Map(
		points.filter((p) => p.family === "gpu").map((p) => [p.n, p.gops]),
	);
	const cpu = new Map(
		points.filter((p) => p.family === "parallel").map((p) => [p.n, p.gops]),
	);

	const ratios = [...gpu.entries()]
		.map(([n, g]) => ({ n, ratio: g / (cpu.get(n) ?? Number.NaN) }))
		.filter((p) => Number.isFinite(p.ratio))
		.sort((a, b) => a.n - b.n);
	if (ratios.length < 2) return null;

	const sizes = log2Ticks(ratios.map((p) => p.n));
	return {
		...BASE,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "mps ÷ best CPU", labelAnchor: "top" },
		marks: [
			Plot.ruleY([1], { stroke: REFERENCE_INK, strokeDasharray: "5 5" }),
			Plot.line(ratios, {
				x: "n",
				y: "ratio",
				stroke: "#e66767",
				strokeWidth: 2,
			}),
			Plot.dot(ratios, { x: "n", y: "ratio", fill: "#e66767", r: 4 }),
			Plot.tip(
				ratios,
				Plot.pointer({
					x: "n",
					y: "ratio",
					title: (d: { ratio: number }) => `${d.ratio.toFixed(2)}×`,
				}),
			),
		],
	};
};

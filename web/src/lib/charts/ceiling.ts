import type { Shape } from "plotly.js-dist-min";
import type { Row } from "../data/db";
import { percentOfPeak } from "../format/numbers";
import type { Family } from "../model/family";
import { FAMILY_INK } from "../palette";
import { familyPeak } from "../peaks/lookup";
import { LABEL_INK } from "./layout";
import type { Ctx } from "./spec";

export interface Ceiling {
	family: Family;
	gflops: number;
	/** The direct label: "1-core peak", "CPU peak (8 P)", "GPU peak". */
	label: string;
}

const CEILING_LABEL: Record<Family, (cores: number) => string> = {
	serial: () => "1-core peak",
	parallel: (cores) => `CPU peak (${cores} P)`,
	gpu: () => "GPU peak",
	// familyPeak lists no matrix-unit peak, so this is unreachable until it does.
	matrix: () => "Matrix peak",
};

/**
 * The ceiling a family's plotted rows are measured against, or undefined
 * when there is none: no peak listed, or rows that span more than one
 * device or precision (contributed runs from several machines). A peak
 * belongs to one machine and one precision, so a mixed set would be
 * measured against a ceiling that is wrong for some of its rows.
 */
export function ceilingOf(
	rows: Row[],
	family: Family,
	ctx: Ctx,
): Ceiling | undefined {
	const devices = new Set(rows.map((r) => String(r.device)));
	const precisions = new Set(rows.map((r) => String(r.precision)));
	if (devices.size !== 1 || precisions.size !== 1) return undefined;
	const [device] = devices;
	const [precision] = precisions;
	const cores = new Set(rows.map((r) => r.gpu_cores));
	const gpuCores = cores.size === 1 ? [...cores][0] : null;
	const peak = familyPeak(ctx.peaks, family, device, precision, gpuCores);
	if (!peak) return undefined;
	return {
		family,
		gflops: peak.gflops,
		label: CEILING_LABEL[family](peak.cores),
	};
}

/**
 * A dashed rule at the ceiling, in the family's ink, labelled at its left end.
 * A shape, so it takes no hover and no legend entry of its own. Its label
 * carries only the dashboard's own strings: layout shapes are not escaped.
 *
 * Labels sit above their line, except the GPU's. That is the highest line on
 * any chart that draws it, so autorange leaves it a few pixels from the plot's
 * top edge, and a shape's label is clipped to the plot area: above the line it
 * would vanish. Below it there is room, since no series is near the GPU peak
 * at the smallest N, where the label sits.
 */
export function ceilingShape(c: Ceiling, legendgroup?: string): Partial<Shape> {
	return {
		type: "line",
		xref: "paper",
		x0: 0,
		x1: 1,
		y0: c.gflops,
		y1: c.gflops,
		line: { color: FAMILY_INK[c.family], dash: "dash", width: 1.5 },
		label: {
			text: c.label,
			textposition: "start",
			yanchor: c.family === "gpu" ? "top" : "bottom",
			font: { color: LABEL_INK, size: 11 },
		},
		...(legendgroup === undefined ? {} : { legendgroup }),
	};
}

/**
 * " · 24% of peak", or "" without a ceiling, so the number and the drawn line
 * always agree.
 */
export function pctOfPeak(gops: number, c: Ceiling | undefined): string {
	if (!c) return "";
	return ` · ${percentOfPeak(gops, c.gflops)}% of peak`;
}

import type { BarData, Layout, ScatterData } from "plotly.js-dist-min";
import type { Peak, Row } from "../data/db";
import { type Family, families } from "../model/family";
import { singleValueKernels } from "../model/knobs";
import { kernels } from "../model/rows";
import { paletteFor } from "../palette";

/** Every chart draws scatter lines or bars. */
export type Trace = Partial<ScatterData> | Partial<BarData>;

/**
 * What a chart hands Plotly: plain JSON, so building and testing a chart never
 * loads the library. Only Chart.svelte imports Plotly at runtime.
 */
export interface Figure {
	data: Trace[];
	layout: Partial<Layout>;
}

export interface Filters {
	precision: string;
	n: number;
	kernel: string;
	/** The pinned value of each swept knob, by params.name. */
	knobs: Record<string, number>;
	/** true renders the chart's relative projection (speedup / ratio). */
	relative: boolean;
}

export interface Ctx {
	palette: Map<string, string>;
	family: Map<string, Family>;
	/** Per knob, the kernels measured at only one value of it: the knob does
	 *  not vary for them, so a pin must not filter them away. */
	singleKnob: Map<string, Set<string>>;
	/** Hardware ceilings from data/peaks.csv. Empty draws no ceiling anywhere. */
	peaks: Peak[];
}

/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[], peaks: Peak[] = []): Ctx {
	const family = families(allRows);
	return {
		palette: paletteFor(kernels(allRows), family),
		family,
		singleKnob: singleValueKernels(allRows),
		peaks,
	};
}

/**
 * A chart that cannot be built from these rows returns null. That single
 * convention hides a panel, a projection toggle, and a whole tab.
 */
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => Figure | null;

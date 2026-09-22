import type { Row } from "../db";
import { gpuRatio, gpuVsCpu } from "./gpu";
import { fastestPerSize, serialOnly, throughputVsSize } from "./overview";
import { throughputByPrecision } from "./precision";
import { parallelEfficiency, throughputVsThreads } from "./threading";
import type { ChartSpec, Ctx, Filters } from "./types";

export type Control = "precision" | "n" | "kernel";

export interface Panel {
	title: string;
	note: string;
	spec: ChartSpec;
}

export interface Tab {
	id: string;
	label: string;
	controls: Control[];
	panels: Panel[];
	/** The precision pills render disabled: precision is this tab's x-axis. */
	inertPrecision?: boolean;
}

export const TABS: Tab[] = [
	{
		id: "overview",
		label: "Overview",
		controls: ["precision"],
		panels: [
			{
				title: "Throughput vs matrix size",
				note: "Each kernel at its best thread count · log–log · band is ±1 stddev",
				spec: throughputVsSize,
			},
			{
				title: "Fastest kernel per size",
				note: "Computed over every kernel, independent of the legend above",
				spec: fastestPerSize,
			},
			{
				title: "Single-threaded kernels",
				note: "Loop order and cache blocking, rescaled away from the parallel kernels",
				spec: serialOnly,
			},
		],
	},
	{
		id: "threads",
		label: "CPU threading",
		controls: ["precision", "n"],
		panels: [
			{
				title: "Throughput vs thread count",
				note: "Linear axes · work-stealing vs fixed partitioning",
				spec: throughputVsThreads,
			},
			{
				title: "Parallel efficiency",
				note: "Speedup as a share of ideal — every size at once, so the N pill does not apply here",
				spec: parallelEfficiency,
			},
		],
	},
	{
		id: "precision",
		label: "Precision",
		controls: ["n"],
		inertPrecision: true,
		panels: [
			{
				title: "Throughput by precision",
				note: "Each kernel at its best thread count, at the selected size",
				spec: throughputByPrecision,
			},
		],
	},
	{
		id: "gpu",
		label: "GPU",
		controls: ["precision"],
		panels: [
			{
				title: "GPU vs CPU",
				note: "mps is dashed: its timed region excludes buffer copies and encoding",
				spec: gpuVsCpu,
			},
			{
				title: "GPU ÷ best CPU",
				note: "Crosses 1.0 where the GPU starts winning",
				spec: gpuRatio,
			},
		],
	},
];

/**
 * The rows a tab actually renders. The precision tab puts precision on its
 * x-axis, so it needs every precision; every other tab is scoped to the
 * selected one. Visibility and rendering must agree, or a tab can appear and
 * then render nothing.
 */
export function rowsForTab(tab: Tab, rows: Row[], precision: string): Row[] {
	return tab.inertPrecision
		? rows
		: rows.filter((r) => r.precision === precision);
}

/** A tab is present iff at least one of its panels can be built. */
export function visibleTabs(rows: Row[], f: Filters, ctx: Ctx): Tab[] {
	return TABS.filter((t) =>
		t.panels.some(
			(p) => p.spec(rowsForTab(t, rows, f.precision), f, ctx) !== null,
		),
	);
}

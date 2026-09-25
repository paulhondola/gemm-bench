import type { Row } from "../db";
import { blockSizeSweep } from "./blocksize";
import { gpuCopyOverhead, gpuEqualEffort, gpuKernels } from "./gpu";
import {
	fastestPerSize,
	serialOnly,
	throughputByFamily,
	throughputVsSize,
} from "./overview";
import { throughputByPrecision } from "./precision";
import { parallelEfficiency, throughputVsThreads } from "./threading";
import type { ChartSpec, Ctx, Filters } from "./types";

export type Control = "precision" | "n" | "kernel" | "blockSize";

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
	/**
	 * Block size is not a dimension of this tab: no pills, and rowsForTab does
	 * not scope by it. Either block size is the x-axis (the Block size tab) or
	 * the tab shows each family's best configuration (Overview, Precision,
	 * GPU), the same way bestPerKernel takes the best thread count. A kernel
	 * measured at only one block size is exempted from scoping automatically,
	 * via `ctx.singleBlockSize` in `rowsForTab`. That's a property of the data,
	 * not something a tab should assert about itself, so it is never a reason
	 * to set this flag.
	 */
	inertBlockSize?: boolean;
}

export const TABS: Tab[] = [
	{
		id: "overview",
		label: "Overview",
		controls: ["precision"],
		inertBlockSize: true,
		panels: [
			{
				title: "Throughput by family",
				note: "Each family's best kernel, thread count and block size at every size · log–log · GPU timings are end-to-end (host copies included), like the CPU timings",
				spec: throughputByFamily,
			},
			{
				title: "Fastest kernel per size",
				note: "Computed over every kernel and coloured by the winner's family",
				spec: fastestPerSize,
			},
		],
	},
	{
		id: "cpu",
		label: "CPU & AMX",
		controls: ["precision", "blockSize"],
		panels: [
			{
				title: "Throughput vs matrix size",
				note: "Each kernel's best thread count, at the selected block size · log–log · band is ±1 stddev",
				spec: throughputVsSize,
			},
			{
				title: "Single-threaded kernels",
				note: "Loop order and cache blocking at the selected block size, rescaled away from the parallel kernels",
				spec: serialOnly,
			},
		],
	},
	{
		id: "threads",
		label: "CPU threading",
		controls: ["precision", "n", "kernel", "blockSize"],
		panels: [
			{
				title: "Throughput vs thread count",
				note: "Linear axes · work-stealing vs fixed partitioning, at the selected block size",
				spec: throughputVsThreads,
			},
			{
				title: "Parallel efficiency",
				note: "Speedup as a share of ideal, for the selected kernel and block size — every size at once, so the N pill does not apply here",
				spec: parallelEfficiency,
			},
		],
	},
	{
		id: "precision",
		label: "Precision",
		controls: ["n"],
		inertPrecision: true,
		inertBlockSize: true,
		panels: [
			{
				title: "Throughput by precision",
				note: "Each family's best kernel, thread count and block size at the selected size · GPU timings are end-to-end",
				spec: throughputByPrecision,
			},
		],
	},
	{
		id: "gpu",
		label: "GPU",
		controls: ["precision"],
		inertBlockSize: true,
		panels: [
			{
				title: "GPU kernels vs CPU",
				note: "GPU timings are end-to-end (host copies and command encoding included), like the CPU timings · references are each family's best kernel, thread count and block size",
				spec: gpuKernels,
			},
			{
				title: "GPU ÷ CPU at equal effort",
				note: "Hand-written shaders against the best hand-written parallel CPU kernel, MPS against the best AMX (Accelerate) kernel · above 1.0 the GPU wins",
				spec: gpuEqualEffort,
			},
			{
				title: "Copy overhead",
				note: "Share of end-to-end time spent copying inputs in, encoding, and copying the result out · copies grow as N², arithmetic as N³",
				spec: gpuCopyOverhead,
			},
		],
	},
	{
		id: "blocksize",
		label: "Block size",
		controls: ["precision", "n"],
		inertBlockSize: true,
		panels: [
			{
				title: "Throughput vs block size",
				note: "Kernels measured at only one block size (e.g. mps) have nothing to sweep and are omitted here. No column records which of the remaining kernels actually do cache blocking — for one that does not, the two points are independent repeat runs, and any gap between them is run-to-run noise, not a block-size effect. Read a large, consistent change as real and a small wobble as noise.",
				spec: blockSizeSweep,
			},
		],
	},
];

/**
 * The rows a tab actually renders. A tab with inertPrecision needs every
 * precision (precision is its x-axis); a tab with inertBlockSize needs every
 * block size (block size is its x-axis, or it shows each family's best
 * configuration). Every other tab is scoped to both selected values, except
 * for a kernel with only one distinct block size in the whole dataset: the
 * dimension doesn't vary for it, so a block-size selection must not filter it
 * away, whichever tab it appears on. A row with no block size (a kernel that
 * doesn't tile) is never filtered by a block-size selection either. This is
 * the single place scoping happens: visibility and rendering must agree, or a
 * tab can appear and then render nothing.
 */
export function rowsForTab(
	tab: Tab,
	rows: Row[],
	precision: string,
	blockSize: number,
	ctx: Ctx,
): Row[] {
	return rows.filter(
		(r) =>
			(tab.inertPrecision || r.precision === precision) &&
			(tab.inertBlockSize ||
				r.block_size == null ||
				ctx.singleBlockSize.has(String(r.kernel)) ||
				Number(r.block_size) === blockSize),
	);
}

/** A tab is present iff at least one of its panels can be built. */
export function visibleTabs(rows: Row[], f: Filters, ctx: Ctx): Tab[] {
	return TABS.filter((t) =>
		t.panels.some(
			(p) =>
				p.spec(rowsForTab(t, rows, f.precision, f.blockSize, ctx), f, ctx) !==
				null,
		),
	);
}

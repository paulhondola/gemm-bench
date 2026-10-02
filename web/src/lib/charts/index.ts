import accuracyVsThroughputDoc from "../../docs/charts/accuracy-vs-throughput.md?raw";
import copyOverheadDoc from "../../docs/charts/copy-overhead.md?raw";
import fastestKernelPerSizeDoc from "../../docs/charts/fastest-kernel-per-size.md?raw";
import gpuKernelsVsCpuDoc from "../../docs/charts/gpu-kernels-vs-cpu.md?raw";
import gpuVsCpuAtEqualEffortDoc from "../../docs/charts/gpu-vs-cpu-at-equal-effort.md?raw";
import optimizationLadderDoc from "../../docs/charts/optimization-ladder.md?raw";
import parallelEfficiencyDoc from "../../docs/charts/parallel-efficiency.md?raw";
import singleThreadedKernelsDoc from "../../docs/charts/single-threaded-kernels.md?raw";
import throughputByFamilyDoc from "../../docs/charts/throughput-by-family.md?raw";
import throughputByPrecisionDoc from "../../docs/charts/throughput-by-precision.md?raw";
import throughputVsBlockSizeDoc from "../../docs/charts/throughput-vs-block-size.md?raw";
import throughputVsMatrixSizeDoc from "../../docs/charts/throughput-vs-matrix-size.md?raw";
import throughputVsThreadCountDoc from "../../docs/charts/throughput-vs-thread-count.md?raw";
import type { Row } from "../db";
import { blockSizeSweep } from "./blocksize";
import { gpuCopyOverhead, gpuEqualEffort, gpuKernels } from "./gpu";
import {
	fastestPerSize,
	optimizationLadder,
	serialOnly,
	throughputByFamily,
	throughputVsSize,
} from "./overview";
import { accuracyVsThroughput, throughputByPrecision } from "./precision";
import { parallelEfficiency, throughputVsThreads } from "./threading";
import type { ChartSpec, Ctx, Filters } from "./types";

export type Control = "precision" | "n" | "kernel" | "blockSize";

export interface Panel {
	title: string;
	/** One line: what's plotted and the scale. The detail is in `doc`. */
	note: string;
	/** "How to read this chart": Markdown from web/src/docs/charts/. */
	doc: string;
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
				title: "Optimization ladder",
				note: "Fastest result of each technique at the largest N every rung measured · log scale · × is the step over the rung above",
				doc: optimizationLadderDoc,
				spec: optimizationLadder,
			},
			{
				title: "Throughput by family",
				note: "Each family's best result at every size · log–log · dashed lines are hardware peaks",
				doc: throughputByFamilyDoc,
				spec: throughputByFamily,
			},
			{
				title: "Fastest kernel per size",
				note: "The fastest kernel at each size, over every kernel, coloured by its family",
				doc: fastestKernelPerSizeDoc,
				spec: fastestPerSize,
			},
		],
	},
	{
		id: "cpu",
		label: "CPU & matrix",
		controls: ["precision", "blockSize"],
		panels: [
			{
				title: "Throughput vs matrix size",
				note: "Each kernel's best thread count, at the selected block size · log–log · band is ±1 stddev",
				doc: throughputVsMatrixSizeDoc,
				spec: throughputVsSize,
			},
			{
				title: "Single-threaded kernels",
				note: "Loop order, cache blocking and register blocking on one core, at the selected block size, on their own scale",
				doc: singleThreadedKernelsDoc,
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
				note: "Work-stealing vs fixed partitioning at the selected size and block size · linear axes",
				doc: throughputVsThreadCountDoc,
				spec: throughputVsThreads,
			},
			{
				title: "Parallel efficiency",
				note: "Speedup as a share of ideal for the selected kernel, at every size (the N pill doesn't apply)",
				doc: parallelEfficiencyDoc,
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
				note: "Each family's best result at the selected size · GPU timings are end-to-end",
				doc: throughputByPrecisionDoc,
				spec: throughputByPrecision,
			},
			{
				title: "Accuracy vs throughput",
				note: "Each float kernel's fastest configuration at the selected size · log–log · exact results are left out",
				doc: accuracyVsThroughputDoc,
				spec: accuracyVsThroughput,
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
				note: "End-to-end GPU timings against the best threaded-CPU and matrix-unit results · log–log · dashed lines are hardware peaks",
				doc: gpuKernelsVsCpuDoc,
				spec: gpuKernels,
			},
			{
				title: "GPU ÷ CPU at equal effort",
				note: "Shaders vs threaded CPU, MPS vs the matrix unit, at each size · above 1.0 the GPU wins",
				doc: gpuVsCpuAtEqualEffortDoc,
				spec: gpuEqualEffort,
			},
			{
				title: "Copy overhead",
				note: "Share of end-to-end GPU time spent copying and encoding · copies grow as N², arithmetic as N³",
				doc: copyOverheadDoc,
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
				note: "Each blocked kernel's best result at each block size, at the selected size · small wobbles are noise",
				doc: throughputVsBlockSizeDoc,
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

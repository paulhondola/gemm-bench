import type { Row } from "../db";
import {
	type Family,
	families,
	kernels,
	singleBlockSizeKernels,
} from "../derive";
import { paletteFor } from "../palette";

/**
 * Derived from Plot.plot's own signature rather than an exported type name,
 * so it stays correct across Plot versions.
 */
export type PlotSpec = NonNullable<
	Parameters<typeof import("@observablehq/plot").plot>[0]
>;

export interface Filters {
	precision: string;
	n: number;
	kernel: string;
	blockSize: number;
	/** true renders the chart's relative projection (speedup / ratio). */
	relative: boolean;
}

export interface Ctx {
	palette: Map<string, string>;
	family: Map<string, Family>;
	/** Kernels measured at exactly one block size: the dimension does not vary
	 *  for them, so a block-size selection must not filter them away. */
	singleBlockSize: Set<string>;
}

/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[]): Ctx {
	return {
		palette: paletteFor(kernels(allRows)),
		family: families(allRows),
		singleBlockSize: singleBlockSizeKernels(allRows),
	};
}

/**
 * A chart that cannot be built from these rows returns null. That single
 * convention hides a panel, a projection toggle, and a whole tab.
 */
export type ChartSpec = (rows: Row[], f: Filters, ctx: Ctx) => PlotSpec | null;

/** Ticks at the sizes actually measured, not at Plot's chosen log decades. */
export function log2Ticks(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Plot's line mark draws straight through a missing point, which would assert a
 * measurement nobody took. The dashboard is built for ragged data — contributed
 * runs are expected to be partial — so give every series an explicit null-y
 * point at each x it lacks, and Plot breaks the line there instead.
 */
export function breakGaps<T>(
	points: T[],
	xs: number[],
	xOf: (p: T) => number,
	seriesOf: (p: T) => string,
	gap: (series: string, x: number) => T,
): T[] {
	const series = [...new Set(points.map(seriesOf))];
	return series.flatMap((s) =>
		xs.map(
			(x) => points.find((p) => seriesOf(p) === s && xOf(p) === x) ?? gap(s, x),
		),
	);
}

/** Shared axis/mark defaults: recessive grid, 2px lines, generous margins. */
export const BASE: Partial<PlotSpec> = {
	style: { background: "transparent", color: "#9aa1a8", fontSize: "12px" },
	marginLeft: 64,
	marginBottom: 44,
	grid: true,
};

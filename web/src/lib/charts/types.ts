import type { Row } from "../db";
import { type Family, families, kernels } from "../derive";
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
	/** true renders the chart's relative projection (speedup / ratio). */
	relative: boolean;
}

export interface Ctx {
	palette: Map<string, string>;
	family: Map<string, Family>;
}

/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[]): Ctx {
	return { palette: paletteFor(kernels(allRows)), family: families(allRows) };
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

/** Shared axis/mark defaults: recessive grid, 2px lines, generous margins. */
export const BASE: Partial<PlotSpec> = {
	style: { background: "transparent", color: "#9aa1a8", fontSize: "12px" },
	marginLeft: 64,
	marginBottom: 44,
	grid: true,
};

import type { Row } from "../data/db";

/** Every precision present in the rows, once each, sorted. */
export function precisions(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.precision)))].sort();
}

/**
 * Host databases are contributed, and the schema allows +Inf (a kernel whose
 * timing rounded to zero). A single non-finite or non-positive n or gops
 * poisons a log scale's whole domain, blanking every series on the chart
 * rather than just the bad row, so unusable rows are dropped at the door.
 */
export function isPlottable(row: Row): boolean {
	const finite = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v);
	const positive = (v: unknown) => finite(v) && v > 0;
	const nonNegative = (v: unknown) => finite(v) && v >= 0;
	return (
		positive(row.n) &&
		positive(row.threads) &&
		positive(row.gops) &&
		positive(row.median_ms) &&
		nonNegative(row.stddev_ms)
	);
}

/** Returns the usable rows and how many were discarded. */
export function partitionPlottable(rows: Row[]): {
	rows: Row[];
	dropped: number;
} {
	const usable = rows.filter(isPlottable);
	return { rows: usable, dropped: rows.length - usable.length };
}

export function kernels(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.kernel)))].sort();
}

export const ascending = (a: number, b: number) => a - b;

export function sizesFor(rows: Row[], precision: string): number[] {
	return [
		...new Set(
			rows.filter((r) => r.precision === precision).map((r) => Number(r.n)),
		),
	].sort(ascending);
}

export function allSizes(rows: Row[]): number[] {
	return [...new Set(rows.map((r) => Number(r.n)))].sort(ascending);
}

export function hasKernel(rows: Row[], kernel: string): boolean {
	return rows.some((r) => r.kernel === kernel);
}

/** A speedup-vs-1-thread projection needs a 1-thread row to divide by. */
export function hasSingleThreadBaseline(rows: Row[]): boolean {
	return rows.some((r) => Number(r.threads) === 1);
}

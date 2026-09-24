import type { Row } from "./db";

/** Every precision present in the rows, once each, sorted. */
export function precisions(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.precision)))].sort();
}

/**
 * Contributor CSVs are untrusted: build.sql only rejects NULLs, so NaN,
 * Infinity, zero and negative values all reach the parquet. A single
 * non-positive n or gops poisons a log scale's whole domain, blanking every
 * series on the chart rather than just the bad row — so unusable rows are
 * dropped at the door.
 */
export function isPlottable(row: Row): boolean {
	const positive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
	const nonNegative = (v: unknown) =>
		Number.isFinite(Number(v)) && Number(v) >= 0;
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

export type Family = "serial" | "parallel" | "amx" | "gpu";

/**
 * Kernel family, read off the rows rather than the kernel's name. A prefix
 * heuristic would break on the first kernel named differently; a kernel is
 * parallel because the harness produced multi-thread rows for it.
 */
export function families(rows: Row[]): Map<string, Family> {
	const out = new Map<string, Family>();
	for (const r of rows) {
		const kernel = String(r.kernel);
		// Vendor backends manage their own threading and record threads=1,
		// so their family comes from the backend, not the thread count.
		if (r.backend === "metal" || r.backend === "amx") {
			out.set(kernel, r.backend === "metal" ? "gpu" : "amx");
			continue;
		}
		if (out.get(kernel) === "gpu" || out.get(kernel) === "amx") continue;
		if (Number(r.threads) > 1 || out.get(kernel) === "parallel") {
			out.set(kernel, "parallel");
		} else if (!out.has(kernel)) {
			out.set(kernel, "serial");
		}
	}
	return out;
}

export function kernels(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.kernel)))].sort();
}

const ascending = (a: number, b: number) => a - b;

/** Rows from kernels that don't tile carry no block size (null). */
const hasBlockSize = (r: Row) => r.block_size != null;

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

/** Every distinct block size present, sorted. */
export function blockSizes(rows: Row[]): number[] {
	return [
		...new Set(rows.filter(hasBlockSize).map((r) => Number(r.block_size))),
	].sort(ascending);
}

/** Block sizes available for a given precision and size, for the disabled-pill reason text. */
export function blockSizesFor(
	rows: Row[],
	precision: string,
	n: number,
): number[] {
	return [
		...new Set(
			rows
				.filter(
					(r) =>
						hasBlockSize(r) && r.precision === precision && Number(r.n) === n,
				)
				.map((r) => Number(r.block_size)),
		),
	].sort(ascending);
}

/**
 * The block size with the widest coverage (most distinct `n` values), ties
 * broken numerically so the choice is stable. 0 when there are no rows.
 */
export function defaultBlockSize(rows: Row[]): number {
	const sizes = blockSizes(rows);
	if (!sizes.length) return 0;
	const coverage = (b: number) =>
		new Set(
			rows.filter((r) => Number(r.block_size) === b).map((r) => Number(r.n)),
		).size;
	return sizes.slice().sort((a, b) => coverage(b) - coverage(a) || a - b)[0];
}

/**
 * The block size to fall back to when the current selection is invalid for
 * this specific (precision, n) — the smallest one actually available there.
 * Unlike `defaultBlockSize`, which picks once over the whole dataset for
 * boot, this must stay valid as precision/n change, so it reads the exact
 * combination the fallback needs to hold for.
 */
export function defaultBlockSizeFor(
	rows: Row[],
	precision: string,
	n: number,
): number {
	return blockSizesFor(rows, precision, n)[0] ?? 0;
}

/** Kernels present at exactly one distinct block_size across the whole
 * dataset: the dimension does not vary for them, so a block-size selection
 * must not filter them away. */
export function singleBlockSizeKernels(rows: Row[]): Set<string> {
	const byKernel = new Map<string, Set<number>>();
	for (const r of rows) {
		if (!hasBlockSize(r)) continue;
		const kernel = String(r.kernel);
		const sizes = byKernel.get(kernel) ?? new Set<number>();
		sizes.add(Number(r.block_size));
		byKernel.set(kernel, sizes);
	}
	return new Set(
		[...byKernel].filter(([, sizes]) => sizes.size === 1).map(([k]) => k),
	);
}

export function threadsFor(
	rows: Row[],
	precision: string,
	n: number,
): number[] {
	return [
		...new Set(
			rows
				.filter((r) => r.precision === precision && Number(r.n) === n)
				.map((r) => Number(r.threads)),
		),
	].sort(ascending);
}

/**
 * f32 when present — it is the CLI default and the canonical comparison.
 * Otherwise the precision covering the most sizes, so the landing chart has
 * the widest x-axis it can. Name order breaks ties so the choice is stable.
 */
export function defaultPrecision(rows: Row[]): string {
	const available = precisions(rows);
	if (available.includes("f32")) return "f32";
	return (
		available
			.slice()
			.sort(
				(a, b) =>
					sizesFor(rows, b).length - sizesFor(rows, a).length ||
					a.localeCompare(b),
			)[0] ?? ""
	);
}

/** The largest size the selected precision actually has, not the largest overall. */
export function defaultSize(rows: Row[], precision: string): number {
	const sizes = sizesFor(rows, precision);
	return sizes[sizes.length - 1] ?? 0;
}

/** The kernel every speedup projection is expressed against. */
export const BASELINE_KERNEL = "naive-ijk";

/**
 * One row per (kernel, n): the kernel's best result at that size, whatever
 * thread count produced it. Pinning a thread count instead would drop every
 * serial kernel, since those only ever have threads=1 rows.
 *
 * A strict `>` keeps the first row on a tie, so the result is stable.
 */
export function bestPerKernel(rows: Row[]): Row[] {
	const best = new Map<string, Row>();
	for (const r of rows) {
		const key = `${r.kernel}\u0000${r.n}`;
		const current = best.get(key);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(key, r);
	}
	return [...best.values()];
}

export function hasKernel(rows: Row[], kernel: string): boolean {
	return rows.some((r) => r.kernel === kernel);
}

/** A speedup-vs-1-thread projection needs a 1-thread row to divide by. */
export function hasSingleThreadBaseline(rows: Row[]): boolean {
	return rows.some((r) => Number(r.threads) === 1);
}

/** The parallel kernel with the highest gops at this precision — T2's default pin. */
export function defaultParallelKernel(rows: Row[], precision: string): string {
	const family = families(rows);
	const candidates = rows.filter(
		(r) =>
			r.precision === precision && family.get(String(r.kernel)) === "parallel",
	);
	let best = "";
	let peak = Number.NEGATIVE_INFINITY;
	for (const r of candidates) {
		if (Number(r.gops) > peak) {
			peak = Number(r.gops);
			best = String(r.kernel);
		}
	}
	return best;
}

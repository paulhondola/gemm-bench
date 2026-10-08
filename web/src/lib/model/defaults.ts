import type { Row } from "../data/db";
import { type Family, families } from "./family";
import { precisions, sizesFor } from "./rows";

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

/** The parallel kernel with the highest gops at this precision — T2's default pin. */
export function defaultParallelKernel(
	rows: Row[],
	precision: string,
	family: Map<string, Family> = families(rows),
): string {
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

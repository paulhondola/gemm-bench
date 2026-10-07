import type { Row } from "../data/db";
import { type Family, familyOf } from "./family";

/**
 * The highest-scoring item per key, keyed in first-seen order. A strict `>`
 * keeps the first item on a tie, so the result is stable: the one rule every
 * "best per" view in the dashboard follows.
 */
export function bestBy<T, K>(
	items: Iterable<T>,
	key: (item: T) => K,
	score: (item: T) => number,
): Map<K, T> {
	const best = new Map<K, T>();
	for (const item of items) {
		const k = key(item);
		const current = best.get(k);
		if (current === undefined || score(item) > score(current))
			best.set(k, item);
	}
	return best;
}

const gops = (r: Row) => Number(r.gops);

/**
 * One row per (kernel, precision, n): the kernel's best result at that size,
 * whatever thread count produced it. Pinning a thread count instead would drop
 * every serial kernel, since those only ever have threads=1 rows. Precision is
 * part of the key because the Precision tab passes every precision at once,
 * and would otherwise merge a kernel's f16, f32 and f64 rows into one point.
 * Every other caller is scoped to one precision, so it changes nothing there.
 *
 * Ties keep the first row (bestBy).
 */
export function bestPerKernel(rows: Row[]): Row[] {
	return [
		...bestBy(
			rows,
			(r) => `${r.kernel}\u0000${r.precision}\u0000${r.n}`,
			gops,
		).values(),
	];
}

/**
 * One row per (family, precision, n): the family's best row, whatever kernel,
 * thread count or knob value produced it. The whole winning row is kept so a
 * family chart can name the kernel behind each point. Precision is part of
 * the key because the Precision tab passes every precision at once. Ties keep
 * the first row (bestBy).
 */
export function bestPerFamily(rows: Row[], family: Map<string, Family>): Row[] {
	return [
		...bestBy(
			rows,
			(r) => `${familyOf(r, family)}\u0000${r.precision}\u0000${r.n}`,
			gops,
		).values(),
	];
}

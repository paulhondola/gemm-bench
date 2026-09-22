import { query, type Row } from "./db";
import {
	defaultBlockSize,
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	partitionPlottable,
} from "./derive";

export const store = $state({
	rows: [] as Row[],
	error: "",
	loaded: false,
	precision: "",
	n: 0,
	kernel: "",
	blockSize: 0,
	relative: false,
	tab: "overview",
	dropped: 0,
});

/** One query at boot; every derivation downstream is synchronous. */
export async function boot(): Promise<void> {
	try {
		const queried = await query("SELECT * FROM results");
		const { rows, dropped } = partitionPlottable(queried);
		store.rows = rows;
		store.dropped = dropped;
		store.precision = defaultPrecision(rows);
		store.n = defaultSize(rows, store.precision);
		store.kernel = defaultParallelKernel(rows, store.precision);
		store.blockSize = defaultBlockSize(rows);
		store.loaded = true;
	} catch (e) {
		store.error = String(e);
	}
}

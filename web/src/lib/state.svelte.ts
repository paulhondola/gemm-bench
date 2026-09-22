import { query, type Row } from "./db";
import { defaultParallelKernel, defaultPrecision, defaultSize } from "./derive";

export const store = $state({
	rows: [] as Row[],
	error: "",
	loaded: false,
	precision: "",
	n: 0,
	kernel: "",
	relative: false,
	tab: "overview",
});

/** One query at boot; every derivation downstream is synchronous. */
export async function boot(): Promise<void> {
	try {
		const rows = await query("SELECT * FROM results");
		store.rows = rows;
		store.precision = defaultPrecision(rows);
		store.n = defaultSize(rows, store.precision);
		store.kernel = defaultParallelKernel(rows, store.precision);
		store.loaded = true;
	} catch (e) {
		store.error = String(e);
	}
}

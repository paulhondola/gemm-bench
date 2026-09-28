import { loadRows, type Row } from "./db";
import {
	defaultBlockSizeFor,
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

/** One fetch at boot; every derivation downstream is synchronous. */
export async function boot(): Promise<void> {
	try {
		// One row per measurement: Metal rows carry end-to-end timings, with
		// the GPU-only median as gpu_ms.
		const { rows, dropped } = partitionPlottable(await loadRows());
		store.rows = rows;
		store.dropped = dropped;
		store.precision = defaultPrecision(rows);
		store.n = defaultSize(rows, store.precision);
		store.kernel = defaultParallelKernel(rows, store.precision);
		store.blockSize = defaultBlockSizeFor(rows, store.precision, store.n);
		store.loaded = true;
	} catch (e) {
		store.error = String(e);
	}
}

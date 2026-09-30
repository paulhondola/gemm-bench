import { loadPeaks, loadRows, type Peak, type Row } from "./db";
import {
	defaultBlockSizeFor,
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	partitionPlottable,
} from "./derive";

export const store = $state({
	rows: [] as Row[],
	peaks: [] as Peak[],
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

/** Both files are fetched at boot; every derivation downstream is synchronous. */
export async function boot(): Promise<void> {
	try {
		// Together, so a missing peaks.json is an error like a missing
		// results.json: `just data` always writes both.
		const [all, peaks] = await Promise.all([loadRows(), loadPeaks()]);
		// One row per measurement: Metal rows carry end-to-end timings, with
		// the GPU-only median as gpu_ms.
		const { rows, dropped } = partitionPlottable(all);
		store.rows = rows;
		store.peaks = peaks;
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

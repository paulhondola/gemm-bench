import peaksCsv from "../../../data/peaks.csv?raw";
import {
	type Machine,
	openDb,
	type Peak,
	type Row,
	readMachine,
	readRows,
} from "./db";
import {
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	partitionPlottable,
	pinKnobs,
} from "./derive";
import { HOSTS } from "./hostlist";
import { type Host, pickHost } from "./hosts";
import { parsePeaks } from "./peaks";
import { loadSql } from "./sqlite";

export const store = $state({
	rows: [] as Row[],
	peaks: [] as Peak[],
	hosts: HOSTS as Host[],
	host: undefined as Host | undefined,
	machine: undefined as Machine | undefined,
	error: "",
	loaded: false,
	precision: "",
	n: 0,
	kernel: "",
	knobs: {} as Record<string, number>,
	relative: false,
	tab: "overview",
	dropped: 0,
});

/**
 * Fetches the selected host's database (`?host=`, else the first) and reads
 * it once; every derivation downstream is synchronous.
 */
export async function boot(): Promise<void> {
	const host = pickHost(HOSTS, location.search);
	store.host = host;
	try {
		store.peaks = parsePeaks(peaksCsv);
		if (host) {
			const [SQL, response] = await Promise.all([loadSql(), fetch(host.url)]);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const db = openDb(SQL, new Uint8Array(await response.arrayBuffer()));
			const { rows, dropped } = partitionPlottable(readRows(db));
			store.machine = readMachine(db);
			db.close();
			store.rows = rows;
			store.dropped = dropped;
			store.precision = defaultPrecision(rows);
			store.n = defaultSize(rows, store.precision);
			store.kernel = defaultParallelKernel(rows, store.precision);
			store.knobs = pinKnobs(rows, store.precision, store.n, {});
		}
		store.loaded = true;
	} catch (e) {
		store.error = host ? `${host.id}: ${e}` : String(e);
	}
}

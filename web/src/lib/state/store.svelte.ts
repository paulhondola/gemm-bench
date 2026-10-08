import peaksCsv from "../../../../data/peaks.csv?raw";
import type { Filters } from "../charts/spec";
import {
	type Machine,
	openDb,
	type Peak,
	type Row,
	readMachine,
	readRows,
} from "../data/db";
import { HOSTS } from "../data/hostlist";
import { type Host, pickHost } from "../data/hosts";
import { loadSql } from "../data/sqlite";
import { partitionPlottable } from "../model/rows";
import { parsePeaks } from "../peaks/parse";
import { initialFilters } from "./filters";

class Store {
	// Raw: replaced wholesale, never mutated. A deep $state proxy would wrap
	// every row and make each scan in the deriveds roughly 10× slower.
	rows = $state.raw<Row[]>([]);
	peaks = $state.raw<Peak[]>([]);
	readonly hosts: Host[] = HOSTS;
	host = $state.raw<Host | undefined>();
	machine = $state.raw<Machine | undefined>();
	error = $state("");
	loaded = $state(false);
	precision = $state("");
	n = $state(0);
	kernel = $state("");
	knobs = $state.raw<Record<string, number>>({});
	relative = $state(false);
	tab = $state("overview");
	dropped = $state(0);
}

export const store = new Store();

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
			let plottable: ReturnType<typeof partitionPlottable>;
			try {
				plottable = partitionPlottable(readRows(db));
				store.machine = readMachine(db);
			} finally {
				db.close();
			}
			const { rows, dropped } = plottable;
			store.rows = rows;
			store.dropped = dropped;
			setFilters(initialFilters(rows));
		}
		store.loaded = true;
	} catch (e) {
		store.error = host ? `${host.id}: ${e}` : String(e);
	}
}

/** Applies a picker change (state/filters.ts); the Relative toggle is per-chart, not a filter rule. */
export function setFilters(f: Filters): void {
	store.precision = f.precision;
	store.n = f.n;
	store.kernel = f.kernel;
	store.knobs = f.knobs;
}

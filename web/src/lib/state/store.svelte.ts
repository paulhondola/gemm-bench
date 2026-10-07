import peaksCsv from "../../../../data/peaks.csv?raw";
import type { Filters } from "../charts/types";
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

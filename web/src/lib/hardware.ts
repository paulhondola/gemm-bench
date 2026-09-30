import type { Peak, Row } from "./db";
import { type Family, familyOf, familyPeak } from "./derive";
import { FAMILY_ORDER } from "./palette";

/** Peaks exist only for the float precisions, so the table covers only them. */
const FLOATS = ["f16", "f32", "f64"];

/** One line of the About tab's peak-vs-measured table. */
export interface EngineRow {
	device: string;
	/** "1 P-core", "8 P-cores", "AMX", "GPU (16 cores)": the dashboard's own strings. */
	engine: string;
	family: Family;
	precision: string;
	/** The ceiling the charts draw for this family (familyPeak); none for AMX. */
	peak: Peak | undefined;
	/** The family's fastest row on this device at this precision, any size. */
	best: Row | undefined;
}

function engineLabel(family: Family, peak: Peak | undefined): string {
	switch (family) {
		case "serial":
			return "1 P-core";
		case "parallel":
			return peak ? `${peak.cores} P-cores` : "CPU (all threads)";
		case "amx":
			return "AMX";
		case "gpu":
			return peak ? `GPU (${peak.cores} cores)` : "GPU";
	}
}

/**
 * Each engine's theoretical peak beside the fastest result it reached: one
 * row per (device, family, float precision) with a peak or a measurement, in
 * FAMILY_ORDER then precision order. The peak comes from familyPeak, so the
 * table and the charts' dashed ceilings always agree. A strict `>` keeps the
 * first row on a tie, so the result is stable.
 */
export function engineRows(
	rows: Row[],
	peaks: Peak[],
	family: Map<string, Family>,
): EngineRow[] {
	const key = (device: string, f: Family, precision: string) =>
		`${device}\u0000${f}\u0000${precision}`;
	const best = new Map<string, Row>();
	for (const r of rows) {
		if (!FLOATS.includes(String(r.precision))) continue;
		const k = key(String(r.device), familyOf(r, family), String(r.precision));
		const current = best.get(k);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(k, r);
	}

	const devices = [
		...new Set([
			...rows.map((r) => String(r.device)),
			...peaks.map((p) => p.device),
		]),
	].sort();
	return devices.flatMap((device) =>
		FAMILY_ORDER.flatMap((f) =>
			FLOATS.flatMap((precision) => {
				const peak = familyPeak(peaks, f, device, precision);
				const top = best.get(key(device, f, precision));
				if (!peak && !top) return [];
				return [
					{
						device,
						engine: engineLabel(f, peak),
						family: f,
						precision,
						peak,
						best: top,
					},
				];
			}),
		),
	);
}

/**
 * The share of a peak reached, in percent, to 2 significant figures: the
 * charts' hover rule (pctOfPeak), so the table and the hover agree.
 */
export function percentOfPeak(gops: number, gflops: number): number {
	return Number(((100 * gops) / gflops).toPrecision(2));
}

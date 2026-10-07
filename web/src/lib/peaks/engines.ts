import type { Peak, Row } from "../data/db";
import { FAMILY_ORDER } from "../design/palette";
import { bestBy } from "../model/best";
import { type Family, familyOf } from "../model/family";
import { familyPeak } from "./lookup";

/** Peaks exist only for the float precisions, so the table covers only them. */
const FLOATS = ["f16", "f32", "f64"];

/** One line of the About tab's peak-vs-measured table. */
export interface EngineRow {
	device: string;
	/** "1 P-core", "8 P-cores", "Matrix unit", "GPU (16 cores)": the dashboard's own strings. */
	engine: string;
	family: Family;
	precision: string;
	/** The ceiling the charts draw for this family (familyPeak); none for the matrix unit. */
	peak: Peak | undefined;
	/** The family's fastest row on this device at this precision, any size. */
	best: Row | undefined;
}

function engineLabel(family: Family, peak: Peak | undefined): string {
	switch (family) {
		// "P-core" is Apple's hybrid-CPU term, so it needs a peak to name one.
		case "serial":
			return peak ? "1 P-core" : "CPU (1 thread)";
		case "parallel":
			return peak ? `${peak.cores} P-cores` : "CPU (all threads)";
		case "matrix":
			return "Matrix unit";
		case "gpu":
			return peak ? `GPU (${peak.cores} cores)` : "GPU";
	}
}

/**
 * Each engine's theoretical peak beside the fastest result it reached: one
 * row per (device, family, float precision) with a peak or a measurement, in
 * FAMILY_ORDER then precision order. The peak comes from familyPeak, so the
 * table and the charts' dashed ceilings always agree. Ties keep the first row
 * (bestBy).
 */
export function engineRows(
	rows: Row[],
	peaks: Peak[],
	family: Map<string, Family>,
): EngineRow[] {
	const key = (device: string, f: Family, precision: string) =>
		`${device}\u0000${f}\u0000${precision}`;
	const best = bestBy(
		rows.filter((r) => FLOATS.includes(String(r.precision))),
		(r) => key(String(r.device), familyOf(r, family), String(r.precision)),
		(r) => Number(r.gops),
	);

	const devices = [
		...new Set([
			...rows.map((r) => String(r.device)),
			...peaks.map((p) => p.device),
		]),
	].sort();
	return devices.flatMap((device) => {
		const gpuCores =
			rows.find((r) => r.device === device && r.gpu_cores !== null)
				?.gpu_cores ?? null;
		return FAMILY_ORDER.flatMap((f) =>
			FLOATS.flatMap((precision) => {
				const peak = familyPeak(peaks, f, device, precision, gpuCores);
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
		);
	});
}

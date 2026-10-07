import type { Row } from "../data/db";
import { ascending } from "./rows";

/** Display names of the swept knobs; an unknown knob shows its params.name. */
export const KNOB_LABEL: Record<string, string> = {
	tile_size: "Tile size",
	depth_block: "Depth block",
};

export const knobLabel = (name: string): string => KNOB_LABEL[name] ?? name;

/**
 * Every swept knob in the rows, once each: one pill group per knob. Known
 * knobs come in KNOB_LABEL order, any other after them, alphabetically.
 */
export function knobNames(rows: Row[]): string[] {
	const known = Object.keys(KNOB_LABEL);
	const rank = (name: string) => {
		const i = known.indexOf(name);
		return i < 0 ? known.length : i;
	};
	return [...new Set(rows.flatMap((r) => Object.keys(r.swept)))].sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b),
	);
}

/** One knob's values, once each, sorted. */
export function knobValues(rows: Row[], name: string): number[] {
	return [
		...new Set(rows.flatMap((r) => (name in r.swept ? [r.swept[name]] : []))),
	].sort(ascending);
}

/** One knob's values at a precision and size: the pills selectable there. */
export function knobValuesFor(
	rows: Row[],
	name: string,
	precision: string,
	n: number,
): number[] {
	return knobValues(
		rows.filter((r) => r.precision === precision && r.n === n),
		name,
	);
}

/**
 * Every knob's pin, kept valid at (precision, n): a pin still measured there
 * stays, any other falls back to the smallest value there, and a knob with
 * no values there has no pin.
 */
export function pinKnobs(
	rows: Row[],
	precision: string,
	n: number,
	current: Record<string, number>,
): Record<string, number> {
	const pins: Record<string, number> = {};
	for (const name of knobNames(rows)) {
		const values = knobValuesFor(rows, name, precision, n);
		if (values.length === 0) continue;
		pins[name] = values.includes(current[name]) ? current[name] : values[0];
	}
	return pins;
}

/**
 * Per knob, the kernels measured at only one value of it in the whole
 * dataset: the knob doesn't vary for them, so a pin must not filter them away.
 */
export function singleValueKernels(rows: Row[]): Map<string, Set<string>> {
	const seen = new Map<string, Map<string, Set<number>>>();
	for (const r of rows) {
		for (const [name, value] of Object.entries(r.swept)) {
			const byKernel = seen.get(name) ?? new Map<string, Set<number>>();
			const values = byKernel.get(r.kernel) ?? new Set<number>();
			values.add(value);
			byKernel.set(r.kernel, values);
			seen.set(name, byKernel);
		}
	}
	return new Map(
		[...seen].map(([name, byKernel]) => [
			name,
			new Set(
				[...byKernel]
					.filter(([, values]) => values.size === 1)
					.map(([kernel]) => kernel),
			),
		]),
	);
}

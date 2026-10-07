import type { Row } from "../data/db";
import type { Ctx } from "./spec";
import type { Tab } from "./tabs";

/**
 * The rows a tab actually renders. A tab with inertPrecision needs every
 * precision (precision is its x-axis); a tab with inertKnobs needs every knob
 * value. Every other tab is scoped to the selected precision and to each
 * knob's pin, except a kernel measured at only one value of a knob, which
 * that knob's pin never filters away. A row with no knobs is never filtered
 * by a pin. This is the single place scoping happens: visibility and
 * rendering must agree, or a tab can appear and then render nothing.
 */
export function rowsForTab(
	tab: Tab,
	rows: Row[],
	precision: string,
	knobs: Record<string, number>,
	ctx: Ctx,
): Row[] {
	return rows.filter(
		(r) =>
			(tab.inertPrecision || r.precision === precision) &&
			(tab.inertKnobs ||
				Object.entries(r.swept).every(
					([name, value]) =>
						ctx.singleKnob.get(name)?.has(r.kernel) || knobs[name] === value,
				)),
	);
}

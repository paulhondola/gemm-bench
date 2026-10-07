import { rowsForTab } from "../charts/scope";
import type { Ctx, Filters } from "../charts/spec";
import type { Tab } from "../charts/tabs";
import type { Row } from "../data/db";
import {
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
} from "../model/defaults";
import { families } from "../model/family";
import { pinKnobs } from "../model/knobs";
import { precisions, sizesFor } from "../model/rows";

/**
 * How the pickers move together: every rule that keeps the size, knob pins
 * and kernel valid when another picker changes lives here, so loading a host
 * and clicking a pill can't disagree.
 */

/** A freshly loaded host's filters: its default precision, then atPrecision's fallbacks. */
export function initialFilters(rows: Row[]): Filters {
	const none = { precision: "", n: 0, kernel: "", knobs: {}, relative: false };
	return atPrecision(rows, none, defaultPrecision(rows));
}

/**
 * The filters after picking precision `p`: the size, knob pins and kernel are
 * kept where still measured at `p`, else fall back to that precision's
 * defaults. The precision pills and precisionsForTab both go through this, so
 * a pill is enabled iff clicking it renders a chart.
 */
export function atPrecision(rows: Row[], f: Filters, p: string): Filters {
	const n = sizesFor(rows, p).includes(f.n) ? f.n : defaultSize(rows, p);
	const family = families(rows);
	const kernelStillValid = rows.some(
		(r) =>
			r.precision === p &&
			r.kernel === f.kernel &&
			family.get(String(r.kernel)) === "parallel",
	);
	return {
		...f,
		precision: p,
		n,
		knobs: pinKnobs(rows, p, n, f.knobs),
		kernel: kernelStillValid ? f.kernel : defaultParallelKernel(rows, p),
	};
}

/**
 * The precisions at which at least one of the tab's panels can be built.
 * Every tab is always shown; one that can't chart the current precision
 * shows a message instead of its panels.
 */
export function precisionsForTab(
	tab: Tab,
	rows: Row[],
	f: Filters,
	ctx: Ctx,
): string[] {
	return precisions(rows).filter((p) => {
		const at = atPrecision(rows, f, p);
		const scoped = rowsForTab(tab, rows, p, at.knobs, ctx);
		return tab.panels.some((panel) => panel.spec(scoped, at, ctx) !== null);
	});
}

/** The filters after picking size `n`: each knob pin kept where still measured there. */
export function withSize(rows: Row[], f: Filters, n: number): Filters {
	return { ...f, n, knobs: pinKnobs(rows, f.precision, n, f.knobs) };
}

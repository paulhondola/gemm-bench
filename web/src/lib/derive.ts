import type { Peak, Row } from "./db";

/** Every precision present in the rows, once each, sorted. */
export function precisions(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.precision)))].sort();
}

/**
 * Host databases are contributed, and the schema allows +Inf (a kernel whose
 * timing rounded to zero). A single non-finite or non-positive n or gops
 * poisons a log scale's whole domain, blanking every series on the chart
 * rather than just the bad row, so unusable rows are dropped at the door.
 */
export function isPlottable(row: Row): boolean {
	const finite = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v);
	const positive = (v: unknown) => finite(v) && v > 0;
	const nonNegative = (v: unknown) => finite(v) && v >= 0;
	return (
		positive(row.n) &&
		positive(row.threads) &&
		positive(row.gops) &&
		positive(row.median_ms) &&
		nonNegative(row.stddev_ms)
	);
}

/** Returns the usable rows and how many were discarded. */
export function partitionPlottable(rows: Row[]): {
	rows: Row[];
	dropped: number;
} {
	const usable = rows.filter(isPlottable);
	return { rows: usable, dropped: rows.length - usable.length };
}

/** A row's params for the data view: `depth_block=256 register_cols=12`. */
export function formatParams(params: Record<string, number>): string {
	return Object.entries(params)
		.map(([name, value]) => `${name}=${value}`)
		.join(" ");
}

export type Family = "serial" | "parallel" | "matrix" | "gpu";

/**
 * Kernel family, read off the rows rather than the kernel's name. A prefix
 * heuristic would break on the first kernel named differently; a kernel is
 * parallel because the harness produced multi-thread rows for it.
 */
export function families(rows: Row[]): Map<string, Family> {
	const out = new Map<string, Family>();
	for (const r of rows) {
		const kernel = String(r.kernel);
		// Vendor backends manage their own threading and record threads=1,
		// so their family comes from the backend, not the thread count.
		if (r.backend === "metal" || r.backend === "matrix") {
			out.set(kernel, r.backend === "metal" ? "gpu" : "matrix");
			continue;
		}
		if (out.get(kernel) === "gpu" || out.get(kernel) === "matrix") continue;
		if (Number(r.threads) > 1 || out.get(kernel) === "parallel") {
			out.set(kernel, "parallel");
		} else if (!out.has(kernel)) {
			out.set(kernel, "serial");
		}
	}
	return out;
}

export function kernels(rows: Row[]): string[] {
	return [...new Set(rows.map((r) => String(r.kernel)))].sort();
}

const ascending = (a: number, b: number) => a - b;

export function sizesFor(rows: Row[], precision: string): number[] {
	return [
		...new Set(
			rows.filter((r) => r.precision === precision).map((r) => Number(r.n)),
		),
	].sort(ascending);
}

export function allSizes(rows: Row[]): number[] {
	return [...new Set(rows.map((r) => Number(r.n)))].sort(ascending);
}

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

/**
 * f32 when present — it is the CLI default and the canonical comparison.
 * Otherwise the precision covering the most sizes, so the landing chart has
 * the widest x-axis it can. Name order breaks ties so the choice is stable.
 */
export function defaultPrecision(rows: Row[]): string {
	const available = precisions(rows);
	if (available.includes("f32")) return "f32";
	return (
		available
			.slice()
			.sort(
				(a, b) =>
					sizesFor(rows, b).length - sizesFor(rows, a).length ||
					a.localeCompare(b),
			)[0] ?? ""
	);
}

/** The largest size the selected precision actually has, not the largest overall. */
export function defaultSize(rows: Row[], precision: string): number {
	const sizes = sizesFor(rows, precision);
	return sizes[sizes.length - 1] ?? 0;
}

/** The kernel every speedup projection is expressed against. */
export const BASELINE_KERNEL = "naive-ijk";

/**
 * One row per (kernel, precision, n): the kernel's best result at that size,
 * whatever thread count produced it. Pinning a thread count instead would drop
 * every serial kernel, since those only ever have threads=1 rows. Precision is
 * part of the key because the Precision tab passes every precision at once,
 * and would otherwise merge a kernel's f16, f32 and f64 rows into one point.
 * Every other caller is scoped to one precision, so it changes nothing there.
 *
 * A strict `>` keeps the first row on a tie, so the result is stable.
 */
export function bestPerKernel(rows: Row[]): Row[] {
	const best = new Map<string, Row>();
	for (const r of rows) {
		const key = `${r.kernel}\u0000${r.precision}\u0000${r.n}`;
		const current = best.get(key);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(key, r);
	}
	return [...best.values()];
}

/** A row's family; a kernel families() never saw counts as serial. */
export function familyOf(row: Row, family: Map<string, Family>): Family {
	return family.get(String(row.kernel)) ?? "serial";
}

/**
 * One row per (family, precision, n): the family's best row, whatever kernel,
 * thread count or knob value produced it. The whole winning row is kept so a
 * family chart can name the kernel behind each point. Precision is part of
 * the key because the Precision tab passes every precision at once. A strict
 * `>` keeps the first row on a tie, so the result is stable.
 */
export function bestPerFamily(rows: Row[], family: Map<string, Family>): Row[] {
	const best = new Map<string, Row>();
	for (const r of rows) {
		const key = `${familyOf(r, family)}\u0000${r.precision}\u0000${r.n}`;
		const current = best.get(key);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(key, r);
	}
	return [...best.values()];
}

/**
 * The hardware ceiling a family is measured against on one device and
 * precision, or undefined when it has none.
 *
 * peaks.csv holds one complete ceiling per core count rather than a per-core
 * rate, because the P-core clock falls as more cores wake: multiplying the
 * 1-core figure up would overstate the 8-core ceiling. So serial reads the
 * 1-core row and parallel the widest cpu row. A cpu with only a 1-core row
 * gives parallel nothing, since that row is the serial ceiling. Apple
 * publishes no matrix-unit peak, so matrix never has one. A GPU ceiling must
 * also match the run's GPU core count.
 */
export function familyPeak(
	peaks: Peak[],
	family: Family,
	device: string,
	precision: string,
	gpuCores: number | null = null,
): Peak | undefined {
	const own = peaks.filter(
		(p) => p.device === device && p.precision === precision,
	);
	const widest = (backend: string) =>
		own
			.filter((p) => p.backend === backend)
			.reduce<Peak | undefined>(
				(best, p) => (!best || p.cores > best.cores ? p : best),
				undefined,
			);
	switch (family) {
		case "serial":
			return own.find((p) => p.backend === "cpu" && p.cores === 1);
		case "parallel": {
			const cpu = widest("cpu");
			return cpu && cpu.cores > 1 ? cpu : undefined;
		}
		case "gpu":
			// The 14- and 16-core M1 Pro GPUs report the same name, so only the
			// run's core count picks the right ceiling; without one, none.
			return gpuCores == null
				? undefined
				: own.find((p) => p.backend === "metal" && p.cores === gpuCores);
		case "matrix":
			return undefined;
	}
}

export function hasKernel(rows: Row[], kernel: string): boolean {
	return rows.some((r) => r.kernel === kernel);
}

/** A speedup-vs-1-thread projection needs a 1-thread row to divide by. */
export function hasSingleThreadBaseline(rows: Row[]): boolean {
	return rows.some((r) => Number(r.threads) === 1);
}

/** The parallel kernel with the highest gops at this precision — T2's default pin. */
export function defaultParallelKernel(rows: Row[], precision: string): string {
	const family = families(rows);
	const candidates = rows.filter(
		(r) =>
			r.precision === precision && family.get(String(r.kernel)) === "parallel",
	);
	let best = "";
	let peak = Number.NEGATIVE_INFINITY;
	for (const r of candidates) {
		if (Number(r.gops) > peak) {
			peak = Number(r.gops);
			best = String(r.kernel);
		}
	}
	return best;
}

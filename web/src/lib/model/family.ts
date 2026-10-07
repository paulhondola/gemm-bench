import type { Row } from "../data/db";

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

/** A row's family; a kernel families() never saw counts as serial. */
export function familyOf(row: Row, family: Map<string, Family>): Family {
	return family.get(String(row.kernel)) ?? "serial";
}

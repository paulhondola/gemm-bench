import type { Peak } from "../data/db";
import type { Family } from "../model/family";

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

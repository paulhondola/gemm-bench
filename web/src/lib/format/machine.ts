import type { Cache, CoreTier, Machine } from "../data/db";
import { formatBytes } from "./numbers";

/** "8P + 2E": each tier's cores, tagged with the initial of the OS's name for it. */
export function tierSummary(tiers: CoreTier[]): string {
	return tiers.map((t) => `${t.cores}${t.name?.[0] ?? ""}`).join(" + ");
}

/** The line under the host picker: CPU, core tiers, GPU. */
export function machineLabel(m: Machine): string {
	const gpu = m.gpu && m.gpu_cores ? `${m.gpu_cores}-core GPU` : (m.gpu ?? "");
	return [m.cpu, tierSummary(m.tiers), gpu]
		.filter((part) => part !== "")
		.join(" · ");
}

/** "L2 unified · 12 MB · shared by 4 · ×2". */
export function cacheLabel(c: Cache): string {
	return [
		`L${c.level} ${c.kind}`,
		formatBytes(c.size_bytes),
		`shared by ${c.shared_by}`,
		`×${c.instances}`,
	].join(" · ");
}

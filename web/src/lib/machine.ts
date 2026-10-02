import type { Cache, CoreTier, Machine } from "./db";

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

/** 65536 → "64 KB", 12582912 → "12 MB": the largest unit that divides evenly. */
export function formatBytes(n: number): string {
	if (n >= 1 << 20 && n % (1 << 20) === 0) return `${n / (1 << 20)} MB`;
	if (n >= 1 << 10 && n % (1 << 10) === 0) return `${n / (1 << 10)} KB`;
	return `${n} B`;
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

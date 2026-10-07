import { expect, test } from "bun:test";
import type { Machine } from "./data/db";
import { cacheLabel, formatBytes, machineLabel, tierSummary } from "./machine";

const m1Pro: Machine = {
	started_at: "2026-10-02T00:00:00Z",
	os: "macOS 27.0.1",
	arch: "aarch64",
	target_features: "dotprod fp16 neon",
	rustc_version: "rustc 1.101.0-nightly",
	cpu: "Apple M1 Pro",
	available_parallelism: 10,
	gpu: "Apple M1 Pro",
	gpu_cores: 16,
	tiers: [
		{ tier: 0, name: "Performance", cores: 8, logical_cpus: 8 },
		{ tier: 1, name: "Efficiency", cores: 2, logical_cpus: 2 },
	],
	caches: [],
};

test("tierSummary tags each tier with its name's initial", () => {
	expect(tierSummary(m1Pro.tiers)).toBe("8P + 2E");
	expect(
		tierSummary([{ tier: 0, name: null, cores: 16, logical_cpus: 32 }]),
	).toBe("16");
	expect(tierSummary([])).toBe("");
});

test("machineLabel names the CPU, its tiers and the GPU", () => {
	expect(machineLabel(m1Pro)).toBe("Apple M1 Pro · 8P + 2E · 16-core GPU");
	expect(
		machineLabel({ ...m1Pro, gpu: null, gpu_cores: null, tiers: [] }),
	).toBe("Apple M1 Pro");
});

test("formatBytes picks the largest whole unit", () => {
	expect(formatBytes(65536)).toBe("64 KB");
	expect(formatBytes(12582912)).toBe("12 MB");
	expect(formatBytes(1310720)).toBe("1280 KB");
	expect(formatBytes(100)).toBe("100 B");
});

test("cacheLabel reads like a spec sheet", () => {
	expect(
		cacheLabel({
			tier: 0,
			level: 2,
			kind: "unified",
			size_bytes: 12 << 20,
			line_bytes: 128,
			shared_by: 4,
			instances: 2,
		}),
	).toBe("L2 unified · 12 MB · shared by 4 · ×2");
});

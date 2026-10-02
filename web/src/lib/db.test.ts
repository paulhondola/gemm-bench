import { expect, test } from "bun:test";
import { openDb, readMachine, readRows } from "./db";
import { fixtureDb, SQL } from "./testdb";

const PACKED_256: [string, number, "swept" | "derived" | "fixed"][] = [
	["depth_block", 256, "swept"],
	["depth_block_used", 256, "derived"],
	["register_cols", 12, "derived"],
	["register_rows", 8, "fixed"],
	["register_col_vectors", 3, "fixed"],
];

const open = (runs: Parameters<typeof fixtureDb>[0]) =>
	openDb(SQL, fixtureDb(runs));

test("the latest run of a cell wins, and older runs stay in the file", () => {
	const rows = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				measurements: [
					{ kernel: "ikj", n: 64, gops: 10 },
					{ kernel: "ikj", n: 128, gops: 11 },
				],
			},
			{
				started_at: "2026-10-02T00:00:00Z",
				measurements: [{ kernel: "ikj", n: 64, gops: 20 }],
			},
		]),
	);
	expect(rows.map((r) => [r.n, r.gops, r.started_at])).toEqual([
		[64, 20, "2026-10-02T00:00:00Z"],
		[128, 11, "2026-10-01T00:00:00Z"],
	]);
});

test("swept params tell cells apart; other params ride along", () => {
	const rows = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				measurements: [
					{ kernel: "packed", n: 256, gops: 80, params: PACKED_256 },
					{
						kernel: "packed",
						n: 256,
						gops: 90,
						params: [
							["depth_block", 512, "swept"],
							["depth_block_used", 256, "derived"],
							["register_cols", 12, "derived"],
							["register_rows", 8, "fixed"],
							["register_col_vectors", 3, "fixed"],
						],
					},
					{ kernel: "ikj", n: 256, gops: 20 },
				],
			},
		]),
	);
	expect(rows).toHaveLength(3);
	const [ikj, packed256] = rows;
	expect(ikj.params).toEqual({});
	expect(ikj.swept).toEqual({});
	expect(packed256.swept).toEqual({ depth_block: 256 });
	expect(packed256.params).toEqual({
		depth_block: 256,
		depth_block_used: 256,
		register_col_vectors: 3,
		register_cols: 12,
		register_rows: 8,
	});
});

test("the device is the run's GPU for Metal rows and its CPU otherwise", () => {
	const rows = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				cpu: "Test CPU",
				gpu: "Test GPU",
				gpu_cores: 14,
				measurements: [
					{ kernel: "ikj", n: 64, gops: 1 },
					{ kernel: "mps", backend: "metal", n: 64, gops: 2 },
				],
			},
		]),
	);
	expect(rows.map((r) => [r.kernel, r.device, r.gpu_cores])).toEqual([
		["ikj", "Test CPU", 14],
		["mps", "Test GPU", 14],
	]);
});

test("+Inf survives, and a NaN error reads as null", () => {
	const [row] = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				measurements: [
					{
						kernel: "ikj",
						n: 64,
						gops: Number.POSITIVE_INFINITY,
						mean_rel_error_f64: Number.NaN,
					},
				],
			},
		]),
	);
	expect(row.gops).toBe(Number.POSITIVE_INFINITY);
	expect(row.mean_rel_error_f64).toBeNull();
});

test("a file that isn't a gemm-bench v1 database is refused", () => {
	const foreign = new SQL.Database();
	foreign.exec("CREATE TABLE notes (x)");
	expect(() => openDb(SQL, foreign.export())).toThrow(
		"not a gemm-bench database",
	);

	const newer = new SQL.Database(
		fixtureDb([{ started_at: "2026-10-01T00:00:00Z", measurements: [] }]),
	);
	newer.exec("PRAGMA user_version = 2");
	expect(() => openDb(SQL, newer.export())).toThrow("schema version 2");
});

test("the machine is the latest run's, tiers and caches included", () => {
	const db = open([
		{ started_at: "2026-10-01T00:00:00Z", cpu: "Old CPU", measurements: [] },
		{
			started_at: "2026-10-02T00:00:00Z",
			tiers: [
				[0, "Performance", 8, 8],
				[1, "Efficiency", 2, 2],
			],
			caches: [
				[null, 3, "unified", 32 << 20, 10, 1],
				[0, 2, "unified", 12 << 20, 4, 2],
			],
			measurements: [],
		},
	]);
	const machine = readMachine(db);
	expect(machine?.cpu).toBe("Apple M1 Pro");
	expect(machine?.tiers.map((t) => t.name)).toEqual([
		"Performance",
		"Efficiency",
	]);
	// Tier caches first, then the ones shared across tiers.
	expect(machine?.caches.map((c) => c.tier)).toEqual([0, null]);
	expect(readMachine(open([]))).toBeUndefined();
});

import initSqlJs from "sql.js";
import schema from "../../../../data/schema.sql?raw";

/** sql.js under Bun: the same engine the dashboard runs in the browser. */
export const SQL = await initSqlJs();

export interface FixtureMeasurement {
	kernel: string;
	backend?: string;
	precision?: string;
	n: number;
	threads?: number;
	gops: number;
	/** null or NaN stores NULL, as the Rust writer does for a NaN error. */
	mean_rel_error_f64?: number | null;
	median_ms?: number;
	gpu_ms?: number | null;
	params?: [
		name: string,
		value: number,
		source: "swept" | "derived" | "fixed",
	][];
}

export interface FixtureRun {
	started_at: string;
	cpu?: string;
	gpu?: string | null;
	gpu_cores?: number | null;
	tiers?: [
		tier: number,
		name: string | null,
		cores: number,
		logicalCpus: number,
	][];
	caches?: [
		tier: number | null,
		level: number,
		kind: string,
		sizeBytes: number,
		sharedBy: number,
		instances: number,
	][];
	measurements: FixtureMeasurement[];
}

/** A host DB built from data/schema.sql, holding `runs` as the Rust writer would. */
export function fixtureDb(runs: FixtureRun[]): Uint8Array {
	const db = new SQL.Database();
	db.exec(schema);
	const lastId = () =>
		Number(db.exec("SELECT last_insert_rowid()")[0].values[0][0]);
	for (const run of runs) {
		db.run(
			`INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch,
			                   target_features, cpu, available_parallelism, gpu, gpu_cores)
			 VALUES (?, 'abc1234', 'rustc 1.101.0-nightly', 5, 'macOS 27.0.1', 'aarch64',
			         'dotprod fp16 neon', ?, 10, ?, ?)`,
			[
				run.started_at,
				run.cpu ?? "Apple M1 Pro",
				run.gpu === undefined ? "Apple M1 Pro" : run.gpu,
				run.gpu_cores === undefined ? 16 : run.gpu_cores,
			],
		);
		const runId = lastId();
		for (const [tier, name, cores, logical] of run.tiers ?? []) {
			db.run("INSERT INTO core_tiers VALUES (?, ?, ?, ?, ?)", [
				runId,
				tier,
				name,
				cores,
				logical,
			]);
		}
		for (const [tier, level, kind, size, sharedBy, instances] of run.caches ??
			[]) {
			db.run("INSERT INTO caches VALUES (?, ?, ?, ?, ?, 128, ?, ?)", [
				runId,
				tier,
				level,
				kind,
				size,
				sharedBy,
				instances,
			]);
		}
		for (const m of run.measurements) {
			const backend = m.backend ?? "cpu";
			const gpuMs =
				m.gpu_ms === undefined ? (backend === "metal" ? 0.5 : null) : m.gpu_ms;
			const error =
				m.mean_rel_error_f64 === undefined ? 1e-7 : m.mean_rel_error_f64;
			db.run(
				`INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops,
				   mean_rel_error_f64, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
				[
					runId,
					m.kernel,
					backend,
					m.precision ?? "f32",
					m.n,
					m.threads ?? 1,
					m.gops,
					error,
					m.median_ms ?? 1,
					m.median_ms ?? 1,
					gpuMs,
				],
			);
			const measurementId = lastId();
			for (const [name, value, source] of m.params ?? []) {
				db.run("INSERT INTO params VALUES (?, ?, ?, ?)", [
					measurementId,
					name,
					value,
					source,
				]);
			}
		}
	}
	const bytes = db.export();
	db.close();
	return bytes;
}

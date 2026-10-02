import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import viewsSql from "./views.sql?raw";

/** One measurement: a row of the `latest` view (views.sql). */
export interface Row {
	kernel: string;
	/** `cpu`, `matrix` or `metal`. */
	backend: string;
	/** The run's GPU for Metal rows, its CPU otherwise. */
	device: string;
	precision: string;
	n: number;
	threads: number;
	gops: number;
	/** null: the kernel's error was NaN, which SQLite stores as NULL. */
	mean_rel_error_f64: number | null;
	median_ms: number;
	min_ms: number;
	stddev_ms: number;
	/** Set exactly on Metal rows. */
	gpu_ms: number | null;
	setup_ms: number;
	/** The run's GPU core count, which picks the GPU's ceiling. */
	gpu_cores: number | null;
	started_at: string;
	commit_id: string;
	repetitions: number;
	/** Every param the kernel recorded, by name. */
	params: Record<string, number>;
	/** The swept params alone: with kernel, precision, n and threads, the cell. */
	swept: Record<string, number>;
	/** Transitional: the one swept value, for the block-size views until they read `swept`. */
	block_size: number | null;
}

/** A hardware ceiling: one row of data/peaks.csv. */
export interface Peak {
	device: string;
	backend: string;
	precision: string;
	cores: number;
	gflops: number;
	source: string;
}

export interface CoreTier {
	tier: number;
	name: string | null;
	cores: number;
	logical_cpus: number;
}

export interface Cache {
	/** null: shared across tiers. */
	tier: number | null;
	level: number;
	kind: string;
	size_bytes: number;
	line_bytes: number | null;
	shared_by: number;
	instances: number;
}

/** The machine as a host's latest run recorded it. */
export interface Machine {
	started_at: string;
	os: string;
	arch: string;
	target_features: string;
	rustc_version: string;
	cpu: string;
	available_parallelism: number;
	gpu: string | null;
	gpu_cores: number | null;
	tiers: CoreTier[];
	caches: Cache[];
}

/** 'GEMM': data/schema.sql's application_id. */
export const APPLICATION_ID = 0x47454d4d;
/** The schema version this dashboard reads. */
export const SCHEMA_VERSION = 1;

function all<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
	const statement = db.prepare(sql, params);
	const rows: T[] = [];
	// getAsObject is untyped (column → SqlValue); each query's T names its columns.
	while (statement.step()) rows.push(statement.getAsObject() as unknown as T);
	statement.free();
	return rows;
}

function pragma(db: Database, name: string): number {
	return Number(db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0]);
}

/**
 * A host database's bytes, opened with the dashboard's views on it. Throws
 * for a file that isn't a gemm-bench database of the version this dashboard
 * reads, so a bad host fails alone.
 */
export function openDb(SQL: SqlJsStatic, bytes: Uint8Array): Database {
	const db = new SQL.Database(bytes);
	try {
		if (pragma(db, "application_id") !== APPLICATION_ID) {
			throw new Error("not a gemm-bench database");
		}
		const version = pragma(db, "user_version");
		if (version !== SCHEMA_VERSION) {
			throw new Error(
				`schema version ${version}; this dashboard reads version ${SCHEMA_VERSION}`,
			);
		}
		db.exec(viewsSql);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

type LatestRow = Omit<Row, "params" | "swept" | "block_size"> & {
	params: string;
	swept_params: string;
};

/** Every cell's latest measurement, with its params parsed. */
export function readRows(db: Database): Row[] {
	return all<LatestRow>(
		db,
		`SELECT kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64,
		        median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, gpu_cores, started_at,
		        commit_id, repetitions, params, swept_params
		 FROM latest ORDER BY kernel, precision, n, threads, swept_params`,
	).map(({ params, swept_params, ...measurement }) => {
		const swept: Record<string, number> = JSON.parse(swept_params);
		const values = Object.values(swept);
		return {
			...measurement,
			params: JSON.parse(params),
			swept,
			block_size: values.length === 1 ? values[0] : null,
		};
	});
}

/** The machine as the host's latest run recorded it; undefined with no runs. */
export function readMachine(db: Database): Machine | undefined {
	const [run] = all<Omit<Machine, "tiers" | "caches"> & { run_id: number }>(
		db,
		`SELECT run_id, started_at, os, arch, target_features, rustc_version, cpu,
		        available_parallelism, gpu, gpu_cores
		 FROM runs ORDER BY started_at DESC LIMIT 1`,
	);
	if (!run) return undefined;
	const { run_id: runId, ...machine } = run;
	return {
		...machine,
		tiers: all<CoreTier>(
			db,
			"SELECT tier, name, cores, logical_cpus FROM core_tiers WHERE run_id = ? ORDER BY tier",
			[runId],
		),
		caches: all<Cache>(
			db,
			`SELECT tier, level, kind, size_bytes, line_bytes, shared_by, instances FROM caches
			 WHERE run_id = ? ORDER BY tier IS NULL, tier, level, kind`,
			[runId],
		),
	};
}

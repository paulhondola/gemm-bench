import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

export type Row = Record<string, string | number | null>;

// ponytail: ships only the EH bundle (wasm exceptions, every browser since 2022).
// Add the MVP bundle + duckdb.selectBundle if an older browser ever matters.
async function open(): Promise<duckdb.AsyncDuckDBConnection> {
	const db = new duckdb.AsyncDuckDB(
		new duckdb.VoidLogger(),
		new Worker(ehWorker),
	);
	await db.instantiate(ehWasm);
	await db.registerFileURL(
		"results.parquet",
		new URL(`${import.meta.env.BASE_URL}results.parquet`, location.href).href,
		duckdb.DuckDBDataProtocol.HTTP,
		false,
	);
	const conn = await db.connect();
	await conn.query("CREATE VIEW results AS SELECT * FROM 'results.parquet'");
	return conn;
}

const connection = open();

/** Runs SQL against the `results` view and returns plain JS rows. */
export async function query(sql: string): Promise<Row[]> {
	const table = await (await connection).query(sql);
	return table.toArray().map((row) =>
		Object.fromEntries(
			Object.entries(row.toJSON()).map(([key, value]) => [
				key,
				// DuckDB BIGINT columns (n, threads) arrive as BigInt.
				typeof value === "bigint" ? Number(value) : (value as Row[string]),
			]),
		),
	);
}

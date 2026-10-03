import initSqlJs, { type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

let loading: Promise<SqlJsStatic> | undefined;

/** sql.js, loaded once; the wasm comes from Vite's content-hashed asset URL. */
export function loadSql(): Promise<SqlJsStatic> {
	loading ??= initSqlJs({ locateFile: () => wasmUrl });
	return loading;
}

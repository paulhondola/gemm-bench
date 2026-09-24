import type { Row } from "./db";

/** A test row; most rows are single-threaded f32 CPU results. */
export function row(fields: Row): Row {
	return { precision: "f32", threads: 1, backend: "cpu", ...fields };
}

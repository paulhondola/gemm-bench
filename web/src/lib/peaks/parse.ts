import type { Peak } from "../data/db";

/** data/peaks.csv's header, exactly. */
export const PEAKS_HEADER = [
	"device",
	"backend",
	"precision",
	"cores",
	"gflops",
	"source",
];

/** RFC 4180: commas and line breaks inside "…" stay in the field, and "" is a literal quote. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += c;
		}
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** data/peaks.csv as typed ceilings. peaks.test.ts holds the file to its rules, so this only converts. */
export function parsePeaks(csv: string): Peak[] {
	const [, ...body] = parseCsv(csv.replace(/^﻿/, ""));
	return body
		.filter((fields) => fields.some((field) => field !== ""))
		.map(([device, backend, precision, cores, gflops, source]) => ({
			device,
			backend,
			precision,
			cores: Number(cores),
			gflops: Number(gflops),
			source,
		}));
}

import { expect, test } from "bun:test";
import peaksCsv from "../../../data/peaks.csv?raw";
import { PEAKS_HEADER, parseCsv, parsePeaks } from "./peaks";

test("parseCsv keeps quoted commas and doubled quotes inside one field", () => {
	expect(parseCsv('a,"b, ""c""",d\n')).toEqual([["a", 'b, "c"', "d"]]);
});

test("parseCsv reads CRLF and a missing final newline", () => {
	expect(parseCsv("a,b\r\nc,d")).toEqual([
		["a", "b"],
		["c", "d"],
	]);
});

// data/peaks.csv is hand-curated: every value in it was typed by someone, so
// a bad one fails the build here instead of drawing a wrong ceiling.
const [header, ...rows] = parseCsv(peaksCsv.replace(/^﻿/, "")).filter((fields) =>
	fields.some((field) => field !== ""),
);
const nameOf = (fields: string[]) => fields.slice(0, 4).join("/");

test("data/peaks.csv starts with the exact header", () => {
	expect(header).toEqual(PEAKS_HEADER);
});

test("every peaks row has six fields", () => {
	expect(rows.filter((fields) => fields.length !== 6).map(nameOf)).toEqual([]);
});

test("every ceiling has every value, a cited source, backend cpu or metal, whole cores ≥ 1 and a finite gflops > 0", () => {
	const bad = rows.filter(
		([device, backend, precision, cores, gflops, source]) =>
			[device, backend, precision, cores, gflops].some(
				(value) => !value?.trim(),
			) ||
			// \s alone misses no-break and zero-width spaces.
			/^[\s\p{Z}\p{C}]*$/u.test(source ?? "") ||
			!["cpu", "metal"].includes(backend) ||
			!/^[1-9][0-9]{0,5}$/.test(cores) ||
			!(Number.isFinite(Number(gflops)) && Number(gflops) > 0),
	);
	expect(bad.map(nameOf)).toEqual([]);
});

test("no ceiling is listed twice", () => {
	const names = rows.map(nameOf);
	expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
});

test("parsePeaks types every row", () => {
	const peaks = parsePeaks(peaksCsv);
	expect(peaks).toHaveLength(rows.length);
	expect(peaks.every((p) => Number.isInteger(p.cores) && p.gflops > 0)).toBe(
		true,
	);
});

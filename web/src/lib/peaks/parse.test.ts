import { expect, test } from "bun:test";
import peaksCsv from "../../../../data/peaks.csv?raw";
import { openDb, type Peak, readRows } from "../data/db";
import { SQL } from "../test/testdb";
import { PEAKS_HEADER, parseCsv, parsePeaks } from "./parse";

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

const RULE = {
	sixFields: "needs exactly six fields",
	everyValue: "has a blank device, backend, precision, cores or gflops",
	source: "has no cited source",
	backend: "has a backend other than cpu or metal",
	cores: "needs a whole number of cores >= 1",
	gflops: "needs a finite gflops > 0",
	twice: "is listed more than once",
} as const;

/** One message per rule a row breaks, named by its device/backend/precision/cores. */
function problems(rows: string[][]): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const fields of rows) {
		const [device, backend, precision, cores, gflops, source] = fields;
		const name = nameOf(fields);
		const broke = (rule: string) => found.push(`${name}: ${rule}`);
		if (fields.length !== 6) broke(RULE.sixFields);
		if ([device, backend, precision, cores, gflops].some((v) => !v?.trim())) {
			broke(RULE.everyValue);
		}
		// \s alone misses no-break and zero-width spaces.
		if (/^[\s\p{Z}\p{C}]*$/u.test(source ?? "")) broke(RULE.source);
		if (!["cpu", "metal"].includes(backend)) broke(RULE.backend);
		if (!/^[1-9][0-9]{0,5}$/.test(cores)) broke(RULE.cores);
		if (!(Number.isFinite(Number(gflops)) && Number(gflops) > 0)) {
			broke(RULE.gflops);
		}
		if (seen.has(name)) broke(RULE.twice);
		seen.add(name);
	}
	return found;
}

test("data/peaks.csv breaks no rule", () => {
	expect(problems(rows)).toEqual([]);
});

// Each rule needs a row that breaks it, or a weakened (or never-firing) rule
// passes against a CSV that happens to be clean.
const GOOD = ["Test CPU", "cpu", "f32", "8", "100.5", "a cited source"];
const edit = (index: number, value: string) =>
	GOOD.map((field, i) => (i === index ? value : field));
const [DEVICE, BACKEND, PRECISION, CORES, GFLOPS, SOURCE] = [0, 1, 2, 3, 4, 5];

test("a clean row breaks no rule", () => {
	expect(problems([GOOD])).toEqual([]);
});

test("a row with a seventh field breaks the field count", () => {
	expect(problems([[...GOOD, "extra"]])).toEqual([
		`${nameOf(GOOD)}: ${RULE.sixFields}`,
	]);
});

test("a blank value breaks the every-value rule", () => {
	for (const bad of [
		edit(DEVICE, ""),
		edit(PRECISION, "  "),
		edit(GFLOPS, ""),
	]) {
		expect(problems([bad])).toContain(`${nameOf(bad)}: ${RULE.everyValue}`);
	}
});

test("a blank, invisible or whitespace-only source breaks the source rule", () => {
	// Empty, a space, a no-break space, and a zero-width space (category Cf).
	for (const source of ["", "  ", "\u00a0", "\u200b", " \u200b\u00a0 "]) {
		const bad = edit(SOURCE, source);
		expect(problems([bad])).toEqual([`${nameOf(bad)}: ${RULE.source}`]);
	}
});

test("a backend other than cpu or metal breaks the backend rule", () => {
	for (const backend of ["matrix", "gpu", "CPU"]) {
		const bad = edit(BACKEND, backend);
		expect(problems([bad])).toEqual([`${nameOf(bad)}: ${RULE.backend}`]);
	}
	expect(problems([edit(BACKEND, "metal")])).toEqual([]);
});

test("cores that aren't a whole number from 1 to 999999 break the cores rule", () => {
	for (const cores of [
		"0",
		"0.5",
		"1.5",
		"-1",
		"1e3",
		"08",
		"1000000",
		"eight",
	]) {
		const bad = edit(CORES, cores);
		expect(problems([bad])).toEqual([`${nameOf(bad)}: ${RULE.cores}`]);
	}
	expect(problems([edit(CORES, "999999")])).toEqual([]);
});

test("a gflops that isn't finite and positive breaks the gflops rule", () => {
	for (const gflops of ["0", "-1", "NaN", "Infinity", "-Infinity", "fast"]) {
		const bad = edit(GFLOPS, gflops);
		expect(problems([bad])).toEqual([`${nameOf(bad)}: ${RULE.gflops}`]);
	}
});

test("a ceiling listed twice breaks the duplicate rule, once per extra row", () => {
	const name = nameOf(GOOD);
	expect(problems([GOOD, GOOD])).toEqual([`${name}: ${RULE.twice}`]);
	expect(problems([GOOD, GOOD, GOOD])).toEqual([
		`${name}: ${RULE.twice}`,
		`${name}: ${RULE.twice}`,
	]);
	// Another core count is another ceiling.
	expect(problems([GOOD, edit(CORES, "1")])).toEqual([]);
});

test("parsePeaks types every row", () => {
	const peaks = parsePeaks(peaksCsv);
	expect(peaks).toHaveLength(rows.length);
	expect(peaks.every((p) => Number.isInteger(p.cores) && p.gflops > 0)).toBe(
		true,
	);
});

const hostKey = (r: { device: string; backend: string; precision: string }) =>
	`${r.device}\u0000${r.backend}\u0000${r.precision}`;

/** The ceilings no host row matches, named by device/backend/precision/cores. */
function unmatched(peaks: Peak[], seen: Set<string>): string[] {
	return peaks
		.filter((p) => !seen.has(hostKey(p)))
		.map((p) => `${p.device}/${p.backend}/${p.precision}/${p.cores}`);
}

test("every ceiling matches a host's device, backend and precision", async () => {
	// A typo in any of the three would silently draw no ceiling.
	const repo = new URL("../../../../", import.meta.url).pathname;
	const seen = new Set<string>();
	for await (const path of new Bun.Glob("data/db/*/*.sqlite").scan({
		cwd: repo,
	})) {
		const bytes = new Uint8Array(
			await Bun.file(`${repo}${path}`).arrayBuffer(),
		);
		const db = openDb(SQL, bytes);
		for (const r of readRows(db)) seen.add(hostKey(r));
		db.close();
	}
	expect(unmatched(parsePeaks(peaksCsv), seen)).toEqual([]);
});

test("a ceiling whose device, backend or precision no host row has goes unmatched", () => {
	const peak = (over: Partial<Peak>): Peak => ({
		device: "Test CPU",
		backend: "cpu",
		precision: "f32",
		cores: 8,
		gflops: 100.5,
		source: "a cited source",
		...over,
	});
	const seen = new Set([hostKey(peak({}))]);
	expect(unmatched([peak({})], seen)).toEqual([]);
	for (const typo of [
		{ device: "Test CPU " },
		{ backend: "metal" },
		{ precision: "f16" },
	]) {
		expect(unmatched([peak(typo)], seen)).toEqual([
			`${typo.device ?? "Test CPU"}/${typo.backend ?? "cpu"}/${typo.precision ?? "f32"}/8`,
		]);
	}
	// Any host's row will do, and only the typo'd ceiling is named.
	expect(unmatched([peak({}), peak({ precision: "f64" })], seen)).toEqual([
		"Test CPU/cpu/f64/8",
	]);
});

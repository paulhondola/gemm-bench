import { expect, test } from "bun:test";
import type { Row } from "../db";
import { row } from "../fixtures";
import {
	canShowScaling,
	parallelEfficiency,
	throughputVsThreads,
} from "./threading";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f16",
	n: 1024,
	kernel: "rayon-ikj",
	blockSize: 32,
	relative: false,
};

const rows: Row[] = [
	row({ kernel: "rayon-ikj", precision: "f16", n: 1024, gops: 52.9 }),
	row({
		kernel: "rayon-ikj",
		precision: "f16",
		n: 1024,
		threads: 4,
		gops: 199.5,
	}),
	row({
		kernel: "rayon-ikj",
		precision: "f16",
		n: 1024,
		threads: 10,
		gops: 394.1,
	}),
	row({ kernel: "static-ikj", precision: "f16", n: 1024, gops: 52.8 }),
	row({
		kernel: "static-ikj",
		precision: "f16",
		n: 1024,
		threads: 4,
		gops: 199.9,
	}),
	row({
		kernel: "static-ikj",
		precision: "f16",
		n: 1024,
		threads: 10,
		gops: 304.8,
	}),
	row({ kernel: "ikj", precision: "f16", n: 1024, gops: 52.5 }),
];

test("the scaling chart builds when a kernel has two thread counts", () => {
	expect(throughputVsThreads(rows, f, makeCtx(rows))).not.toBeNull();
});

test("serial-only rows are not a scaling chart", () => {
	const serial = rows.filter((r) => r.kernel === "ikj");
	expect(throughputVsThreads(serial, f, makeCtx(serial))).toBeNull();
});

test("the speedup projection needs a 1-thread row", () => {
	expect(canShowScaling(rows)).toBe(true);
	expect(canShowScaling(rows.filter((r) => r.threads !== 1))).toBe(false);
});

test("efficiency builds per size and caps the axis at 100", () => {
	const spec = parallelEfficiency(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	expect(spec?.y?.domain).toEqual([0, 100]);
});

test("efficiency without a 1-thread baseline is not shown", () => {
	const noBase = rows.filter((r) => r.threads !== 1);
	expect(parallelEfficiency(noBase, f, makeCtx(noBase))).toBeNull();
});

test("the legend lists only the kernels plotted, not the whole palette", () => {
	// ikj is serial (filtered out by parallelRows), so it must not appear in
	// the color domain even though it's in the fixture and the palette.
	const spec = throughputVsThreads(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	if (!spec) return;
	expect(spec.color?.domain).toEqual(
		expect.arrayContaining(["rayon-ikj", "static-ikj"]),
	);
	expect(spec.color?.domain).toHaveLength(2);
});

test("parallelEfficiency plots only the selected kernel, one line per size", () => {
	const spec = parallelEfficiency(rows, f, makeCtx(rows));
	expect(spec).not.toBeNull();
	if (!spec) return;
	// marks[0] is Plot.line(points, ...): the first mark pushed.
	const points = (spec.marks[0] as unknown as { data: { n: string }[] }).data;
	const rayonRows = rows.filter((r) => r.kernel === "rayon-ikj");
	expect(points).toHaveLength(rayonRows.length);
});

test("parallelEfficiency hides when the pinned kernel has no rows", () => {
	expect(
		parallelEfficiency(rows, { ...f, kernel: "does-not-exist" }, makeCtx(rows)),
	).toBeNull();
});

test("the scaling chart plots only the selected size", () => {
	const twoSizes: Row[] = [
		...rows,
		row({ kernel: "rayon-ikj", precision: "f16", n: 256, gops: 9 }),
		row({
			kernel: "rayon-ikj",
			precision: "f16",
			n: 256,
			threads: 4,
			gops: 33,
		}),
		row({
			kernel: "rayon-ikj",
			precision: "f16",
			n: 256,
			threads: 10,
			gops: 70,
		}),
	];
	const spec = throughputVsThreads(twoSizes, f, makeCtx(twoSizes));
	expect(spec).not.toBeNull();
	if (!spec) return; // unreachable: the assertion above throws first
	// marks[0] is Plot.line(points, ...): the first mark pushed when f.relative
	// is false (no ideal-line mark prepended), verified against the actual
	// spec rather than assumed.
	const plotted = (spec.marks[0] as unknown as { data: { threads: number }[] })
		.data;
	// f pins n = 1024, so the three n = 256 rows must not appear.
	expect(plotted).toHaveLength(rows.filter((r) => r.kernel !== "ikj").length);
});

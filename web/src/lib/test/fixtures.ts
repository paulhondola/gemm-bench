import type { Datum } from "plotly.js-dist-min";
import type { Figure } from "../charts/types";
import type { Peak, Row } from "../data/db";

/**
 * A test row: a single-threaded f32 CPU result on the M1 Pro unless the
 * fields say otherwise. Timings left out are NaN, as they read when missing.
 */
export function row(fields: Partial<Row>): Row {
	return {
		kernel: "",
		backend: "cpu",
		device: "Apple M1 Pro",
		precision: "f32",
		n: Number.NaN,
		threads: 1,
		gops: Number.NaN,
		mean_rel_error_f64: Number.NaN,
		median_ms: Number.NaN,
		min_ms: Number.NaN,
		stddev_ms: Number.NaN,
		gpu_ms: null,
		setup_ms: Number.NaN,
		gpu_cores: fields.backend === "metal" ? 16 : null,
		started_at: "2026-10-01T00:00:00Z",
		commit_id: "test",
		repetitions: 5,
		params: {},
		swept: {},
		...fields,
	};
}

/** A test peak: a 1-core f32 CPU ceiling on the same device row() defaults to. */
export function peak(fields: Partial<Peak>): Peak {
	return {
		device: "Apple M1 Pro",
		backend: "cpu",
		precision: "f32",
		cores: 1,
		gflops: 100,
		source: "test",
		...fields,
	};
}

export interface Point {
	x: Datum;
	y: Datum;
	custom: Datum[];
}

/**
 * A series' points in x order, gaps included (y null). Found by name, so a
 * test never depends on where a trace sits in the figure.
 */
export function pointsOf(fig: Figure | null, name: string): Point[] {
	const t = fig?.data.find((d) => d.name === name);
	const x = (t?.x ?? []) as Datum[];
	const y = (t?.y ?? []) as Datum[];
	const custom = (t?.customdata ?? []) as Datum[][];
	return x.map((xi, i) => ({
		x: xi,
		y: y[i] ?? null,
		custom: custom[i] ?? [],
	}));
}

/** The series a figure's legend lists, and the colour each is drawn in. */
export function legendOf(fig: Figure | null): {
	names: string[];
	colors: string[];
} {
	const shown = (fig?.data ?? []).filter((t) => t.showlegend !== false);
	return {
		names: shown.map((t) => String(t.name)),
		colors: shown.map((t) => String(t.marker?.color)),
	};
}

/** Every measured point of every legend series, gaps left out. */
export function plotted(fig: Figure | null): (Point & { series: string })[] {
	return legendOf(fig).names.flatMap((series) =>
		pointsOf(fig, series)
			.filter((p) => p.y !== null)
			.map((p) => ({ ...p, series })),
	);
}

/** Serial, parallel and GPU kernels over two f32 sizes, plus one i64 row. */
export const mixed: Row[] = [
	row({ kernel: "ikj", n: 64, gops: 10 }),
	row({ kernel: "ikj", n: 128, gops: 12 }),
	row({ kernel: "rayon-ikj", n: 64, gops: 10 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 38 }),
	row({ kernel: "mps", n: 64, gops: 2, backend: "metal" }),
	row({ kernel: "ikj", precision: "i64", n: 4096, gops: 6 }),
];

/** rayon-ikj at 1, 4 and 8 threads beside a serial ikj, all at N = 64. */
export const threaded: Row[] = [
	row({ kernel: "rayon-ikj", n: 64, gops: 10 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 38 }),
	row({ kernel: "rayon-ikj", n: 64, threads: 8, gops: 31 }),
	row({ kernel: "ikj", n: 64, gops: 12 }),
];

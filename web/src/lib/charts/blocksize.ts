import * as Plot from "@observablehq/plot";
import { BASE, breakGaps, log2Ticks, type PlotChartSpec } from "./types";

type BlockPoint = { block_size: number; kernel: string; gops: number };
type BlockGapPoint = { block_size: number; kernel: string; gops: null };

/**
 * One line per kernel: x is block size, so the best (kernel, block_size)
 * result at the pinned N — the same reason the size chart pins nothing but
 * takes each kernel's best across threads, only here threads AND n are both
 * pinned by the caller's row scoping / f.n filter.
 */
export const blockSizeSweep: PlotChartSpec = (rows, f, ctx) => {
	// ctx.singleBlockSize is the same predicate rowsForTab uses to *keep* a
	// one-block-size kernel (e.g. mps) visible on pinned tabs — there it's a
	// valid measurement to show. Here it's the opposite: a kernel with nothing
	// to sweep contributes no comparison, only a lone point that can dominate
	// the linear y-axis and squash the kernels that do vary.
	const atSize = rows.filter(
		(r) =>
			r.block_size != null &&
			Number(r.n) === f.n &&
			ctx.palette.has(String(r.kernel)) &&
			!ctx.singleBlockSize.has(String(r.kernel)),
	);

	const best = new Map<string, BlockPoint>();
	for (const r of atSize) {
		const key = `${r.kernel}\u0000${r.block_size}`;
		const current = best.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops) {
			best.set(key, {
				block_size: Number(r.block_size),
				kernel: String(r.kernel),
				gops,
			});
		}
	}
	const points = [...best.values()];
	const sizes = log2Ticks(points.map((p) => p.block_size));
	if (sizes.length < 2) return null;

	// Scoped to what's actually plotted, not the whole-dataset palette, so the
	// legend never lists a kernel this chart doesn't draw.
	const present = [...new Set(points.map((p) => p.kernel))];
	const showLabels = present.length <= 4;

	// Plot draws a line straight through a block size a kernel has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<BlockPoint | BlockGapPoint>(
		points,
		sizes,
		(p) => p.block_size,
		(p) => p.kernel,
		(kernel, block_size) => ({ block_size, kernel, gops: null }),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: {
			type: "log",
			base: 2,
			ticks: sizes,
			tickFormat: String,
			label: "Block size",
		},
		y: { type: "linear", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			Plot.line(lineData, {
				x: "block_size",
				y: "gops",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "block_size", y: "gops", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.block_size === sizes[sizes.length - 1]),
							{
								x: "block_size",
								y: "gops",
								text: "kernel",
								dx: 6,
								textAnchor: "start",
								fill: "#9aa1a8",
								fontSize: 11,
							},
						),
					]
				: []),
			Plot.tip(
				points,
				Plot.pointer({
					x: "block_size",
					y: "gops",
					title: (d: { kernel: string; gops: number }) =>
						`${d.kernel}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

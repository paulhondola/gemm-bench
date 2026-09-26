import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
} from "./types";

type BlockPoint = { block_size: number; kernel: string; gops: number };

/**
 * One line per kernel: x is block size, so the best (kernel, block_size)
 * result at the pinned N — the same reason the size chart pins nothing but
 * takes each kernel's best across threads, only here threads AND n are both
 * pinned by the caller's row scoping / f.n filter.
 */
export const blockSizeSweep: ChartSpec = (rows, f, ctx) => {
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

	return {
		data: lineTraces(
			points.map((p) => ({
				series: p.kernel,
				x: p.block_size,
				y: p.gops,
				custom: [],
			})),
			{
				order: present,
				color: (k) => ctx.palette.get(k) as string,
				xs: sizes,
				labels: showLabels,
				hovertemplate: "<b>%{y:.1f} GOP/s</b>  %{fullData.name}<extra></extra>",
			},
		),
		layout: {
			...BASE_LAYOUT,
			...(showLabels ? { margin: LABELLED_MARGIN } : {}),
			xaxis: log2Axis(sizes, "Block size"),
			yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
		},
	};
};

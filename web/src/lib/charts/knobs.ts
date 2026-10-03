import { knobLabel } from "../derive";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
} from "./types";

type KnobPoint = { value: number; kernel: string; gops: number };

/**
 * One line per kernel that sweeps the knob `name`: x is the knob's value and
 * y the kernel's best result there at the pinned N, whatever thread count got
 * it, the same way the size chart takes each kernel's best across threads.
 */
export function knobSweep(name: string): ChartSpec {
	return (rows, f, ctx) => {
		// A kernel measured at one value has nothing to sweep: its lone point
		// would only stretch the linear y-axis and squash the kernels that vary.
		const atSize = rows.filter(
			(r) =>
				name in r.swept &&
				r.n === f.n &&
				ctx.palette.has(r.kernel) &&
				!ctx.singleKnob.get(name)?.has(r.kernel),
		);
		const best = new Map<string, KnobPoint>();
		for (const r of atSize) {
			const value = r.swept[name];
			const key = `${r.kernel}\u0000${value}`;
			const current = best.get(key);
			if (!current || r.gops > current.gops)
				best.set(key, { value, kernel: r.kernel, gops: r.gops });
		}
		const points = [...best.values()];
		const xs = log2Ticks(points.map((p) => p.value));
		if (xs.length < 2) return null;

		// Scoped to what's plotted, so the legend never lists a kernel this chart doesn't draw.
		const present = [...new Set(points.map((p) => p.kernel))];
		const showLabels = present.length <= 4;
		return {
			data: lineTraces(
				points.map((p) => ({
					series: p.kernel,
					x: p.value,
					y: p.gops,
					custom: [],
				})),
				{
					order: present,
					color: (k) => ctx.palette.get(k) as string,
					xs,
					labels: showLabels,
					hovertemplate:
						"<b>%{y:.1f} GOP/s</b>  %{fullData.name}<extra></extra>",
				},
			),
			layout: {
				...BASE_LAYOUT,
				...(showLabels ? { margin: LABELLED_MARGIN } : {}),
				xaxis: log2Axis(xs, knobLabel(name)),
				yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
			},
		};
	};
}

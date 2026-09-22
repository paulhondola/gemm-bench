import * as Plot from "@observablehq/plot";
import { BASE, type ChartSpec } from "./types";

/**
 * Grouped bars, one group per precision. The precision pill group is inert on
 * this tab: precision is the x-axis here, so filtering by it would leave one
 * bar. `f.n` still pins the size.
 */
export const throughputByPrecision: ChartSpec = (rows, f, ctx) => {
	const atSize = rows.filter(
		(r) => Number(r.n) === f.n && ctx.palette.has(String(r.kernel)),
	);

	// Best per (kernel, precision) at this size, for the same reason the size
	// chart uses best-per-kernel: pinning threads would drop serial kernels.
	const best = new Map<
		string,
		{ precision: string; kernel: string; gops: number }
	>();
	for (const r of atSize) {
		const key = `${r.kernel}\u0000${r.precision}`;
		const current = best.get(key);
		const gops = Number(r.gops);
		if (!current || gops > current.gops) {
			best.set(key, {
				precision: String(r.precision),
				kernel: String(r.kernel),
				gops,
			});
		}
	}
	const bars = [...best.values()];
	const order = [...new Set(bars.map((b) => b.precision))].sort(
		(a, b) =>
			Math.max(...bars.filter((x) => x.precision === b).map((x) => x.gops)) -
			Math.max(...bars.filter((x) => x.precision === a).map((x) => x.gops)),
	);
	if (order.length < 2) return null;

	return {
		...BASE,
		fx: { domain: order, label: "Precision" },
		x: { axis: null },
		y: { type: "linear", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: [...ctx.palette.keys()],
			range: [...ctx.palette.values()],
			legend: true,
		},
		marks: [
			// fx facets by precision and x separates the kernels inside each
			// facet: barY would stack them if both shared one x channel.
			Plot.barY(bars, {
				fx: "precision",
				x: "kernel",
				y: "gops",
				fill: "kernel",
				// 2px surface gap between adjacent bars.
				insetLeft: 1,
				insetRight: 1,
			}),
			Plot.tip(
				bars,
				Plot.pointer({
					x: "precision",
					y: "gops",
					title: (d: { kernel: string; gops: number }) =>
						`${d.kernel}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

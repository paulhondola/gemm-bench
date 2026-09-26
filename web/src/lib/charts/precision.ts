import * as Plot from "@observablehq/plot";
import { bestPerFamily, familyOf } from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import { BASE, type ChartSpec } from "./types";

type Bar = { precision: string; family: string; kernel: string; gops: number };

/**
 * Grouped bars, one group per precision and one bar per family: each family's
 * best kernel at the selected size. Families, not kernels, because this chart
 * crosses the host and GPU colour groups. The precision pill group is inert
 * on this tab: precision is the x-axis here, so filtering by it would leave
 * one group. `f.n` still pins the size.
 */
export const throughputByPrecision: ChartSpec = (rows, f, ctx) => {
	const bars: Bar[] = bestPerFamily(
		rows.filter((r) => Number(r.n) === f.n),
		ctx.family,
	).map((r) => ({
		precision: String(r.precision),
		family: familyOf(r, ctx.family),
		kernel: String(r.kernel),
		gops: Number(r.gops),
	}));
	const order = [...new Set(bars.map((b) => b.precision))].sort(
		(a, b) =>
			Math.max(...bars.filter((x) => x.precision === b).map((x) => x.gops)) -
			Math.max(...bars.filter((x) => x.precision === a).map((x) => x.gops)),
	);
	if (order.length < 2) return null;

	// Scoped to the families actually plotted, in the validated legend order;
	// x uses the same order so adjacent bars are the validated adjacent pairs.
	const present = FAMILY_ORDER.filter((family) =>
		bars.some((b) => b.family === family),
	);

	return {
		...BASE,
		fx: { domain: order, label: "Precision" },
		x: { axis: null, domain: present },
		y: { type: "linear", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: present,
			range: present.map((family) => FAMILY_INK[family]),
			legend: true,
		},
		marks: [
			// fx facets by precision and x separates the families inside each
			// facet: barY would stack them if both shared one x channel.
			Plot.barY(bars, {
				fx: "precision",
				x: "family",
				y: "gops",
				fill: "family",
				// 2px surface gap between adjacent bars.
				insetLeft: 1,
				insetRight: 1,
			}),
			Plot.tip(
				bars,
				Plot.pointer({
					fx: "precision",
					x: "family",
					y: "gops",
					title: (d: Bar) =>
						`${d.family} · ${d.kernel}\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

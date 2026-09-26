import { bestPerFamily, familyOf } from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import { AXIS, BASE_LAYOUT, type ChartSpec } from "./types";

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

	// Scoped to the families actually plotted, in the validated legend order.
	// One trace per family, so within every group the bars sit in that order
	// and adjacent bars are the validated adjacent pairs. A family missing at
	// a precision leaves its slot empty rather than shifting its neighbours.
	const present = FAMILY_ORDER.filter((family) =>
		bars.some((b) => b.family === family),
	);

	return {
		data: present.map((family) => {
			const mine = bars.filter((b) => b.family === family);
			return {
				type: "bar",
				name: family,
				uid: family,
				x: mine.map((b) => b.precision),
				y: mine.map((b) => b.gops),
				customdata: mine.map((b) => [b.kernel]),
				marker: { color: FAMILY_INK[family] },
				hovertemplate:
					"<b>%{y:.1f} GOP/s</b>  %{fullData.name} · %{customdata[0]}<extra></extra>",
			};
		}),
		layout: {
			...BASE_LAYOUT,
			// Each bar is its own hit target; a crosshair readout is for lines.
			hovermode: "closest",
			barmode: "group",
			// A thin surface gap between adjacent bars in a group.
			bargroupgap: 0.05,
			xaxis: {
				...AXIS,
				type: "category",
				categoryorder: "array",
				categoryarray: order,
				title: { text: "Precision" },
			},
			yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
		},
	};
};

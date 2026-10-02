import { bestPerFamily, bestPerKernel, familyOf } from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import { AXIS, BASE_LAYOUT, type ChartSpec, uidOf } from "./types";

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

/**
 * Marker shape per float precision, in trace order. Shape carries precision
 * and colour carries family, so a point reads as both at once. Integers have
 * no entry: their results are exact, which a log axis can't show.
 */
const FLOAT_SYMBOL = new Map<string, "circle" | "square" | "diamond">([
	["f16", "circle"],
	["f32", "square"],
	["f64", "diamond"],
]);

/**
 * Mean relative error against GOP/s: one point per kernel and float precision,
 * at its fastest configuration for the selected size. This is the accuracy
 * half of the precision story: f16 `mps` accumulates in f32 and is as fast as
 * f16 `accelerate-bnns` at a fraction of its error.
 *
 * A log error axis can't place a result that equals the reference (error 0:
 * every integer kernel, and every f64 CPU kernel, which adds in the
 * reference's order) or a non-finite one (null), so those are left out. The
 * panel note says so. The precision pill group is inert here, as on the panel
 * above; `f.n` pins the size.
 */
export const accuracyVsThroughput: ChartSpec = (rows, f, ctx) => {
	const points = bestPerKernel(
		rows.filter(
			(r) => Number(r.n) === f.n && FLOAT_SYMBOL.has(String(r.precision)),
		),
	).filter(
		(r) =>
			r.mean_rel_error_f64 !== null &&
			Number.isFinite(r.mean_rel_error_f64) &&
			r.mean_rel_error_f64 > 0,
	);
	if (points.length === 0) return null;

	// familyOf reads the whole dataset's map, so a kernel keeps its family
	// whatever this size happens to contain.
	return {
		data: FAMILY_ORDER.flatMap((family) =>
			[...FLOAT_SYMBOL].flatMap(([precision, symbol]) => {
				const mine = points.filter(
					(r) =>
						familyOf(r, ctx.family) === family && r.precision === precision,
				);
				if (mine.length === 0) return [];
				return [
					{
						type: "scatter",
						mode: "markers",
						name: precision,
						uid: uidOf(`${family} ${precision}`),
						// The title names the family once, over its precisions.
						legendgroup: family,
						legendgrouptitle: { text: family },
						x: mine.map((r) => Number(r.mean_rel_error_f64)),
						y: mine.map((r) => Number(r.gops)),
						customdata: mine.map((r) => [String(r.kernel), Number(r.threads)]),
						marker: { color: FAMILY_INK[family], symbol, size: 10 },
						hovertemplate:
							"<b>%{customdata[0]}</b> · %{fullData.name} · %{customdata[1]}T<br>%{x:.2~e} mean relative error · %{y:.1f} GOP/s<extra></extra>",
					},
				];
			}),
		),
		layout: {
			...BASE_LAYOUT,
			hovermode: "closest",
			// Each entry hides only its own points: the default would hide the
			// family's every precision at once.
			legend: { ...BASE_LAYOUT.legend, groupclick: "toggleitem" },
			xaxis: {
				...AXIS,
				type: "log",
				exponentformat: "power",
				title: { text: "Mean relative error vs f64 reference" },
			},
			yaxis: { ...AXIS, type: "log", title: { text: "GOP/s" } },
		},
	};
};

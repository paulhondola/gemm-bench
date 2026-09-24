import { BASELINE_KERNEL } from "./derive";

/**
 * The nine validated categorical slots for the dark surface (#15181b).
 * Worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3, all nine
 * at or above 3:1 contrast. Do not substitute or re-step these values, and
 * never extend the list with a hue picked by eye: a further series folds into
 * the best-per-family view instead. The baseline kernel sits outside the slots
 * in BASELINE_INK, which is what makes room for ten kernels.
 *
 * Slot 9 (accelerate-bnns) was searched over OKLCH, not generated: of every
 * in-band, in-gamut candidate it best clears the floors against ALL eight
 * slots and BASELINE_INK, not just its neighbour: CVD ΔE ≥ 10.2 (nearest:
 * magenta), normal-vision ΔE ≥ 16.2 (nearest: violet), contrast 3.02:1. Its
 * contrast margin is thin, so re-validate if the surface changes.
 */
const SLOTS = [
	"#3987e5", // 1 blue
	"#d95926", // 2 orange
	"#199e70", // 3 aqua
	"#c98500", // 4 yellow
	"#d55181", // 5 magenta
	"#008300", // 6 green
	"#9085e9", // 7 violet
	"#e66767", // 8 red
	"#844da2", // 9 purple
] as const;

export const MAX_SERIES = SLOTS.length;

/** Muted ink for the ideal-linear and ratio=1.0 reference rules. */
export const REFERENCE_INK = "#5b636b";

/**
 * Fill for a winner that has no palette slot — a 9th+ kernel can still win a
 * size on fastestPerSize (computed over every kernel, not the 8-slot
 * legend), and must render visibly rather than as `fill: undefined`. The
 * theme's muted-text token; #0e1012 cell text stays legible on it.
 */
export const UNPALETTED_FILL = "#9aa1a8";

/**
 * Neutral ink for naive-ijk, the reference every "× vs naive-ijk" view divides
 * by. Lighter than every slot on purpose: mid grays collide with the aqua,
 * magenta and red slots under CVD. Validated pairwise against all eight: CVD
 * ΔE ≥ 8 and normal-vision ΔE ≥ 15 each, ≥ 3:1 contrast.
 */
export const BASELINE_INK = "#b4bac0";

/**
 * Fixed assignment order, arranged so the most-compared pairs land on
 * adjacent slots — adjacent pairs are the validated worst case.
 */
const ORDER = [
	"accelerate-blas",
	"ikj",
	"tiled",
	"rayon-ikj",
	"static-ikj",
	"rayon-tiled",
	"static-tiled",
	"mps",
	"accelerate-bnns",
];

/**
 * Pass the kernels of the WHOLE dataset, not the filtered subset. Colour
 * follows the entity, so a legend toggle must never repaint the survivors.
 */
export function paletteFor(allKernels: string[]): Map<string, string> {
	const present = [...new Set(allKernels)];
	const out = new Map<string, string>();

	// A known kernel takes its documented slot whatever else is present, so
	// filtering the dataset can never repaint a kernel that survives.
	for (const kernel of present) {
		const slot = ORDER.indexOf(kernel);
		if (slot !== -1) out.set(kernel, SLOTS[slot]);
	}
	if (present.includes(BASELINE_KERNEL)) out.set(BASELINE_KERNEL, BASELINE_INK);

	// Unknown kernels fill only the slots no known kernel claimed, in sorted
	// order, and never receive a generated hue once those run out.
	const free = SLOTS.filter((_, i) => !out.has(ORDER[i]));
	const unknown = present.filter((k) => !out.has(k)).sort();
	for (let i = 0; i < Math.min(unknown.length, free.length); i++) {
		out.set(unknown[i], free[i]);
	}

	return out;
}

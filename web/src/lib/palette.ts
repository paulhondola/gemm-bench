/**
 * The eight validated categorical slots for the dark surface (#15181b).
 * Worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3, all eight
 * at or above 3:1 contrast. Do not substitute or re-step these values, and
 * never extend the list with a generated hue: a ninth series folds into the
 * best-per-family view instead.
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
 * Fixed assignment order, arranged so the most-compared pairs land on
 * adjacent slots — adjacent pairs are the validated worst case.
 */
const ORDER = [
	"naive-ijk",
	"ikj",
	"tiled",
	"rayon-ikj",
	"static-ikj",
	"rayon-tiled",
	"static-tiled",
	"mps",
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

	// Unknown kernels fill only the slots no known kernel claimed, in sorted
	// order, and never receive a generated hue once those run out.
	const free = SLOTS.filter((_, i) => !out.has(ORDER[i]));
	const unknown = present.filter((k) => !ORDER.includes(k)).sort();
	for (let i = 0; i < Math.min(unknown.length, free.length); i++) {
		out.set(unknown[i], free[i]);
	}

	return out;
}

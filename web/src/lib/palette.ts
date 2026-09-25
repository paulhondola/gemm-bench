import { BASELINE_KERNEL, type Family } from "./derive";

/**
 * The nine validated categorical slots for the dark surface (#15181b).
 * Worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3, all nine
 * at or above 3:1 contrast. Do not substitute or re-step these values, and
 * never extend the list with a hue picked by eye: a further series folds into
 * a family view or reuses a slot in another colour group (see SLOT_OF). The
 * baseline kernel sits outside the slots in BASELINE_INK, which is what makes
 * room for ten kernels.
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
 * Family ink for charts that cross families (Overview, Precision, the GPU
 * tab's CPU references), in legend order serial → parallel → AMX → GPU. Any
 * two families can sit side by side (the fastest-per-size winner can change
 * at every size), so this set is validated on ALL pairs, not just adjacent
 * ones (validate_palette.js --pairs all, dark, #15181b): worst CVD ΔE 8.6,
 * normal-vision 17.8, all ≥ 3:1. It is the only all-pairs-passing set of four
 * slots that keeps GPU on red. In legend order the worst adjacent pair is
 * 19.2 / 29.0.
 */
export const FAMILY_ORDER: Family[] = ["serial", "parallel", "amx", "gpu"];
export const FAMILY_INK: Record<Family, string> = {
	serial: SLOTS[8], // purple
	parallel: SLOTS[5], // green
	amx: SLOTS[0], // blue
	gpu: SLOTS[7], // red
};

/**
 * Kernel colour groups. No chart draws kernels from both groups (a view that
 * crosses them draws families instead), so a slot need only be unique within
 * its group, and the GPU group reuses host slots.
 */
type Group = "host" | "gpu";

/**
 * Documented slots per group, arranged so the most-compared pairs land on
 * adjacent slots (adjacent pairs are the validated worst case). Host: the
 * original order, except that mps moved to the GPU group, which frees slot 8
 * (red) for the next host kernel. GPU: validated in legend order metal-naive,
 * metal-tiled, mps, then the AMX and parallel references (dark, #15181b):
 * worst adjacent CVD ΔE 19.2, normal-vision 22.5 over all five; 19.5 / 22.5
 * for the three kernels alone; all ≥ 3:1. Maps, not object literals: kernel
 * names come from contributed CSVs, and "constructor" must not resolve.
 */
const SLOT_OF: Record<Group, Map<string, number>> = {
	host: new Map([
		["accelerate-blas", 0],
		["ikj", 1],
		["tiled", 2],
		["rayon-ikj", 3],
		["static-ikj", 4],
		["rayon-tiled", 5],
		["static-tiled", 6],
		["accelerate-bnns", 8],
	]),
	gpu: new Map([
		["metal-naive", 1],
		["metal-tiled", 6],
		["mps", 7],
	]),
};

/**
 * Slots a group never hands to an unknown kernel. GPU kernels are drawn beside
 * the other families' reference lines, so the GPU group keeps clear of their
 * ink (serial purple, parallel green, AMX blue).
 */
const RESERVED: Record<Group, number[]> = { host: [], gpu: [8, 5, 0] };

/**
 * Pass the kernels of the WHOLE dataset, not the filtered subset, and the
 * family map built from the same rows. Colour follows the entity, so a legend
 * toggle must never repaint the survivors.
 */
export function paletteFor(
	allKernels: string[],
	family: Map<string, Family>,
): Map<string, string> {
	const present = [...new Set(allKernels)];
	const out = new Map<string, string>();
	const held: Record<Group, Set<number>> = {
		host: new Set(RESERVED.host),
		gpu: new Set(RESERVED.gpu),
	};

	// A documented kernel takes its slot whatever else is present, so filtering
	// the dataset can never repaint a kernel that survives.
	for (const kernel of present) {
		for (const group of ["host", "gpu"] as const) {
			const slot = SLOT_OF[group].get(kernel);
			if (slot === undefined) continue;
			out.set(kernel, SLOTS[slot]);
			held[group].add(slot);
		}
	}
	if (present.includes(BASELINE_KERNEL)) out.set(BASELINE_KERNEL, BASELINE_INK);

	// Unknown kernels fill only their own group's free slots, in sorted order,
	// and never receive a generated hue once those run out.
	for (const kernel of present.filter((k) => !out.has(k)).sort()) {
		const group: Group = family.get(kernel) === "gpu" ? "gpu" : "host";
		const slot = SLOTS.findIndex((_, i) => !held[group].has(i));
		if (slot === -1) continue;
		out.set(kernel, SLOTS[slot]);
		held[group].add(slot);
	}
	return out;
}

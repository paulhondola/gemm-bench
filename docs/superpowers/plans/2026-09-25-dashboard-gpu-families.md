# Dashboard GPU Kernels and Per-Family Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `metal-naive`, `metal-tiled` and `mps` on the dashboard with end-to-end timings, colour cross-family charts by family, and rebuild the GPU tab around equal-effort comparisons and copy overhead.

**Architecture:** One load-time step (`withEndToEnd`) folds each Metal `X`/`X-e2e` row pair into one row named `X` with end-to-end timings plus a `gpu_ms` field. The palette splits kernels into a host group and a GPU group that may reuse slots, and adds an all-pairs-validated family ink. Charts that cross families (Overview, Precision, GPU references) draw families; per-kernel charts draw one group.

**Tech Stack:** Svelte 5, TypeScript, Observable Plot 0.6.17, DuckDB-WASM, `bun test`, Biome 2.5.

**Spec:** `docs/superpowers/specs/2026-09-25-dashboard-gpu-families-design.md`

## Global Constraints

- Branch `feat/dashboard-gpu-families`. Do not push.
- Touch only `web/src/lib/**` and `README.md`. No new dependencies.
- Run everything from `web/`: tests `bun test`, lint `bunx @biomejs/biome check --write <files>`.
- Type gate: `bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'` must print nothing. (`bun run typecheck` checks no files; svelte-check has 34 pre-existing errors, all in `*.test.ts`.)
- In new test code, index marks as `spec?.marks?.[i]` (`PlotSpec.marks` is optional).
- Hexes, verbatim: family ink serial `#844da2`, parallel `#008300`, amx `#3987e5`, gpu `#e66767`; kernels `metal-naive` `#d95926`, `metal-tiled` `#9085e9`, `mps` `#e66767`. Every host kernel keeps its current hex.
- Family legend order everywhere: serial, parallel, amx, gpu. GPU-tab legend order: `metal-naive`, `metal-tiled`, `mps`, `AMX`, `parallel CPU`.
- Dashes only on reference rules (ideal-linear, ratio = 1.0).
- Row fields are read through `Number(...)` / `String(...)`, as the existing code does.
- Match the surrounding comment style: comments say why, not what.
- Commit messages: imperative sentence, no `feat:` prefix, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never bypass lefthook.

---

### Task 1: Fold GPU-only and end-to-end rows into one row per measurement

**Files:**
- Modify: `web/src/lib/derive.ts` (append after `partitionPlottable`)
- Modify: `web/src/lib/state.svelte.ts:22-35`
- Test: `web/src/lib/derive.test.ts`

**Interfaces:**
- Consumes: `Row` from `./db`.
- Produces: `withEndToEnd(rows: Row[]): Row[]`. Every returned row has a `gpu_ms` field (`number | null`), and no returned `kernel` ends in `-e2e`. `boot()` stores its output in `store.rows`.

- [ ] **Step 1: Write the failing tests**

Add `withEndToEnd` to the import list in `web/src/lib/derive.test.ts`, then append:

```ts
// Both rows of one Metal measurement share host and timestamp.
const gpuRun = { backend: "metal", host: "h", timestamp: "t1" };

test("withEndToEnd folds a GPU pair into one row with end-to-end timings", () => {
	const out = withEndToEnd([
		row({ ...gpuRun, kernel: "mps", n: 512, gops: 883, median_ms: 0.304 }),
		row({ ...gpuRun, kernel: "mps-e2e", n: 512, gops: 699, median_ms: 0.384 }),
	]);
	expect(out).toHaveLength(1);
	expect(out[0]).toMatchObject({
		kernel: "mps",
		gops: 699,
		median_ms: 0.384,
		gpu_ms: 0.304,
	});
});

test("a GPU-only row without its -e2e twin is dropped, not used as end-to-end", () => {
	const out = withEndToEnd([
		row({ ...gpuRun, kernel: "mps", n: 512, gops: 883, median_ms: 0.304 }),
	]);
	expect(out).toEqual([]);
});

test("an -e2e row without its GPU-only twin keeps gpu_ms null", () => {
	const out = withEndToEnd([
		row({ ...gpuRun, kernel: "mps-e2e", n: 512, gops: 699, median_ms: 0.384 }),
	]);
	expect(out).toEqual([
		expect.objectContaining({ kernel: "mps", gpu_ms: null }),
	]);
});

test("rows from different runs never pair", () => {
	const out = withEndToEnd([
		row({ ...gpuRun, kernel: "mps", n: 512, gops: 883, median_ms: 0.304 }),
		row({
			...gpuRun,
			timestamp: "t2",
			kernel: "mps-e2e",
			n: 512,
			gops: 699,
			median_ms: 0.384,
		}),
	]);
	expect(out).toEqual([
		expect.objectContaining({ kernel: "mps", gpu_ms: null }),
	]);
});

test("CPU rows pass through with gpu_ms null", () => {
	const cpu = row({ kernel: "ikj", n: 64, gops: 10 });
	expect(withEndToEnd([cpu])).toEqual([{ ...cpu, gpu_ms: null }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/derive.test.ts`
Expected: FAIL, `withEndToEnd` is not exported from `./derive`.

- [ ] **Step 3: Implement `withEndToEnd`**

Append to `web/src/lib/derive.ts` after `partitionPlottable`:

```ts
const E2E_SUFFIX = "-e2e";

/** The fields one measurement's GPU-only row and its `-e2e` twin share. */
function measurementKey(r: Row, kernel: string): string {
	return [
		kernel,
		r.precision,
		r.n,
		r.threads,
		r.block_size,
		r.host,
		r.timestamp,
	].join("\u0000");
}

/**
 * Metal kernels record two rows per measurement: `X` times GPU execution only,
 * `X-e2e` adds the host copies and command encoding. CPU kernels are timed
 * host-memory-in to host-memory-out, so any GPU-vs-CPU comparison must use the
 * `-e2e` timing. Each pair folds into one row named `X` with the end-to-end
 * timings, keeping the GPU-only median as `gpu_ms` for the copy-overhead
 * chart. A GPU-only row with no `-e2e` twin is dropped rather than silently
 * standing in for end-to-end. Every other row gets `gpu_ms: null`, so the data
 * view (which reads its columns off the first row) stays uniform.
 */
export function withEndToEnd(rows: Row[]): Row[] {
	const gpuOnly = new Map<string, Row>();
	for (const r of rows) {
		const kernel = String(r.kernel);
		if (r.backend === "metal" && !kernel.endsWith(E2E_SUFFIX)) {
			gpuOnly.set(measurementKey(r, kernel), r);
		}
	}
	const out: Row[] = [];
	for (const r of rows) {
		const kernel = String(r.kernel);
		if (r.backend !== "metal") {
			out.push({ ...r, gpu_ms: null });
		} else if (kernel.endsWith(E2E_SUFFIX)) {
			const base = kernel.slice(0, -E2E_SUFFIX.length);
			const twin = gpuOnly.get(measurementKey(r, base));
			out.push({
				...r,
				kernel: base,
				gpu_ms: twin ? Number(twin.median_ms) : null,
			});
		}
	}
	return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test src/lib/derive.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Wire it into boot**

In `web/src/lib/state.svelte.ts`, add `withEndToEnd` to the `./derive` import and replace the first lines of `boot()`'s `try` block:

```ts
		const queried = await query("SELECT * FROM results");
		const { rows: usable, dropped } = partitionPlottable(queried);
		// One row per measurement from here on: Metal rows carry end-to-end
		// timings under their plain name (see withEndToEnd).
		const rows = withEndToEnd(usable);
		store.rows = rows;
		store.dropped = dropped;
```

Leave the rest of `boot()` unchanged. It already reads `rows`.

- [ ] **Step 6: Full suite, lint, type gate**

Run: `cd web && bun test && bunx @biomejs/biome check --write src/lib/derive.ts src/lib/derive.test.ts src/lib/state.svelte.ts && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: every test passes, Biome reports no errors, and the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/derive.ts web/src/lib/derive.test.ts web/src/lib/state.svelte.ts
git commit -m "Fold each Metal measurement into one end-to-end row with gpu_ms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Split kernel colours into host and GPU groups, add family ink

**Files:**
- Modify: `web/src/lib/palette.ts` (replace the section from `ORDER` through `paletteFor`, and add the family-ink constants)
- Modify: `web/src/lib/charts/types.ts:36-42` (`makeCtx`)
- Modify: `web/src/lib/charts/gpu.ts:4,28-33,57-59,69-73` (use the shared family ink)
- Test: `web/src/lib/palette.test.ts`, `web/src/lib/charts/overview.test.ts` (one fixture)

**Interfaces:**
- Consumes: `Family` type and `BASELINE_KERNEL` from `./derive`.
- Produces:
  - `paletteFor(allKernels: string[], family: Map<string, Family>): Map<string, string>`
  - `FAMILY_ORDER: Family[]` = `["serial", "parallel", "amx", "gpu"]`
  - `FAMILY_INK: Record<Family, string>`
  - `makeCtx` now passes the family map to `paletteFor`.

- [ ] **Step 1: Write the failing tests**

Replace `web/src/lib/palette.test.ts` with:

```ts
import { expect, test } from "bun:test";
import type { Family } from "./derive";
import {
	BASELINE_INK,
	FAMILY_INK,
	FAMILY_ORDER,
	MAX_SERIES,
	paletteFor,
} from "./palette";

const all = [
	"accelerate-blas",
	"accelerate-bnns",
	"ikj",
	"mps",
	"naive-ijk",
	"rayon-ikj",
	"rayon-tiled",
	"static-ikj",
	"static-tiled",
	"tiled",
];
const gpuKernels = ["metal-naive", "metal-tiled", "mps"];
const none = new Map<string, Family>();

test("known kernels take their documented slot", () => {
	const p = paletteFor([...all, ...gpuKernels], none);
	expect(p.get("accelerate-blas")).toBe("#3987e5");
	expect(p.get("ikj")).toBe("#d95926");
	expect(p.get("tiled")).toBe("#199e70");
	expect(p.get("accelerate-bnns")).toBe("#844da2");
	expect(p.get("mps")).toBe("#e66767");
	expect(p.get("metal-naive")).toBe("#d95926");
	expect(p.get("metal-tiled")).toBe("#9085e9");
});

test("the naive-ijk baseline is neutral ink, outside the categorical slots", () => {
	const p = paletteFor(all, none);
	expect(p.get("naive-ijk")).toBe(BASELINE_INK);
	// Ten kernels, ten distinct colours: the baseline frees a slot.
	expect(p.size).toBe(all.length);
	expect(new Set(p.values()).size).toBe(all.length);
});

test("GPU kernels reuse host slots but never collide within their group", () => {
	const p = paletteFor([...all, ...gpuKernels], none);
	expect(p.get("metal-naive")).toBe(p.get("ikj"));
	expect(new Set(gpuKernels.map((k) => p.get(k))).size).toBe(3);
});

test("a survivor keeps its colour when another kernel is filtered out", () => {
	const full = paletteFor(all, none);
	const without = paletteFor(
		all.filter((k) => k !== "accelerate-blas"),
		none,
	);
	expect(without.get("mps")).toBe(full.get("mps"));
	expect(without.get("naive-ijk")).toBe(full.get("naive-ijk"));
	expect(without.has("accelerate-blas")).toBe(false);
});

test("an unknown kernel takes a free slot, never an occupied one", () => {
	const p = paletteFor(
		[...all.filter((k) => k !== "tiled"), "packed-simd"],
		none,
	);
	expect(p.get("packed-simd")).toBe("#199e70");
	expect(new Set(p.values()).size).toBe(p.size);
});

test("an unknown GPU kernel skips the other families' ink", () => {
	const p = paletteFor(
		[...gpuKernels, "metal-simdgroup"],
		new Map<string, Family>([["metal-simdgroup", "gpu"]]),
	);
	// Slots 0 (AMX blue), 5 (parallel green) and 8 (serial purple) are the
	// reference inks drawn beside GPU kernels; slot 1 is metal-naive's. The
	// first free GPU slot is 2.
	expect(p.get("metal-simdgroup")).toBe("#199e70");
});

test("a group that runs out of slots caps rather than generating a hue", () => {
	// mps moved to the GPU group, so the host group has one free slot (red).
	const p = paletteFor([...all, "packed-simd", "packed-simd-2"], none);
	expect(p.get("packed-simd")).toBe("#e66767");
	expect(p.has("packed-simd-2")).toBe(false);
	expect(p.size).toBe(MAX_SERIES + 2); // 9 host + mps + the baseline
});

test("family ink is the all-pairs-validated set, in legend order", () => {
	expect(FAMILY_ORDER).toEqual(["serial", "parallel", "amx", "gpu"]);
	expect(FAMILY_ORDER.map((f) => FAMILY_INK[f])).toEqual([
		"#844da2",
		"#008300",
		"#3987e5",
		"#e66767",
	]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/palette.test.ts`
Expected: FAIL. `FAMILY_INK`/`FAMILY_ORDER` are not exported, and the metal kernels have no colour.

- [ ] **Step 3: Implement the grouped palette**

In `web/src/lib/palette.ts`:

1. Change the import to `import { BASELINE_KERNEL, type Family } from "./derive";`.
2. Leave `SLOTS` (and its comment), `MAX_SERIES`, `REFERENCE_INK`, `UNPALETTED_FILL` and `BASELINE_INK` exactly as they are.
3. Delete the `ORDER` constant with its comment and the old `paletteFor`, and put this in their place:

```ts
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
```

4. In the `SLOTS` doc comment, replace the sentence "a further series folds into the best-per-family view instead." with "a further series folds into a family view or reuses a slot in another colour group (see SLOT_OF)."

- [ ] **Step 4: Pass the family map in `makeCtx`**

In `web/src/lib/charts/types.ts`, replace `makeCtx` with:

```ts
/** Built once from the whole dataset so colour never depends on the filter. */
export function makeCtx(allRows: Row[]): Ctx {
	const family = families(allRows);
	return {
		palette: paletteFor(kernels(allRows), family),
		family,
		singleBlockSize: singleBlockSizeKernels(allRows),
	};
}
```

- [ ] **Step 5: Point the existing GPU chart at the shared ink**

In `web/src/lib/charts/gpu.ts`:
- Change the palette import to `import { FAMILY_INK, FAMILY_ORDER, REFERENCE_INK } from "../palette";`.
- Delete the local `const FAMILY_INK = { ... } as const;` block.
- Replace the `inked` declaration and the `color` option in `gpuVsCpu` with:

```ts
	// Runs without an Accelerate kernel have no amx rows; keep it out of their legend.
	const inked = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.family === family),
	);
```

```ts
		color: {
			domain: inked,
			range: inked.map((family) => FAMILY_INK[family]),
			legend: true,
		},
```

(Task 4 deletes this chart. The change only keeps the build green until then.)

- [ ] **Step 6: Keep the fastest-per-size fallback test's premise**

In `web/src/lib/charts/overview.test.ts`, inside the test "a kernel outside the palette still gets a visible, defined fill when it wins a size", add a filler row just before the `packed-simd` row and update the comment:

```ts
		// mps moved to the GPU group, freeing one host slot; this filler sorts
		// before packed-simd and claims it, so packed-simd still has none.
		row({ kernel: "aaa-filler", n: 64, gops: 1 }),
		row({ kernel: "packed-simd", n: 64, gops: 999 }),
```

Change the comment above `expect(ctx.palette.has("packed-simd")).toBe(false);` to `// Every host slot is taken, so a further host kernel has no entry.`

- [ ] **Step 7: Full suite, lint, type gate**

Run: `cd web && bun test && bunx @biomejs/biome check --write src/lib/palette.ts src/lib/palette.test.ts src/lib/charts/types.ts src/lib/charts/gpu.ts src/lib/charts/overview.test.ts && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: every test passes, no Biome errors, and the grep prints nothing.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/palette.ts web/src/lib/palette.test.ts web/src/lib/charts/types.ts web/src/lib/charts/gpu.ts web/src/lib/charts/overview.test.ts
git commit -m "Give GPU kernels their own colour group and validate family ink on all pairs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Family Overview and a CPU & AMX tab

**Files:**
- Modify: `web/src/lib/derive.ts` (add `familyOf`, `bestPerFamily` after `bestPerKernel`)
- Modify: `web/src/lib/charts/overview.ts` (new `throughputByFamily`, GPU-free `throughputVsSize`, family-filled `fastestPerSize`, delete the dashed-`mps` split)
- Modify: `web/src/lib/charts/index.ts` (Overview and new `cpu` tab, `inertBlockSize` and `rowsForTab` docs)
- Modify: `web/src/lib/palette.ts` (delete `UNPALETTED_FILL`)
- Test: `web/src/lib/derive.test.ts`, `web/src/lib/charts/overview.test.ts`, `web/src/lib/charts/index.test.ts`

**Interfaces:**
- Consumes: `FAMILY_INK`, `FAMILY_ORDER` (Task 2); rows already folded by `withEndToEnd` (Task 1).
- Produces:
  - `familyOf(row: Row, family: Map<string, Family>): Family` (unknown → `"serial"`)
  - `bestPerFamily(rows: Row[], family: Map<string, Family>): Row[]`: one winning row per (family, precision, n), strict `>` so the first row wins a tie
  - `throughputByFamily: ChartSpec` in `overview.ts`
  - Tab ids in order: `overview`, `cpu`, `threads`, `precision`, `gpu`, `blocksize`

- [ ] **Step 1: Write the failing derive test**

Add `bestPerFamily` and `familyOf` to the import list in `web/src/lib/derive.test.ts` and append:

```ts
test("bestPerFamily keeps each family's winning row per precision and size", () => {
	const rows: Row[] = [
		row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 174 }),
		row({ kernel: "rayon-tiled", n: 512, threads: 8, gops: 161 }),
		row({
			kernel: "rayon-tiled",
			precision: "i32",
			n: 512,
			threads: 8,
			gops: 167,
		}),
		row({ kernel: "mps", n: 512, gops: 699, backend: "metal" }),
		row({ kernel: "metal-tiled", n: 512, gops: 268, backend: "metal" }),
	];
	const best = bestPerFamily(rows, families(rows));
	expect(best.map((r) => `${r.kernel}@${r.precision}`).sort()).toEqual([
		"mps@f32",
		"rayon-ikj@f32",
		"rayon-tiled@i32",
	]);
});

test("familyOf counts a kernel the family map never saw as serial", () => {
	expect(familyOf(row({ kernel: "mystery", n: 64, gops: 1 }), new Map())).toBe(
		"serial",
	);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && bun test src/lib/derive.test.ts`
Expected: FAIL, `bestPerFamily` and `familyOf` are not exported.

- [ ] **Step 3: Implement `familyOf` and `bestPerFamily`**

Append to `web/src/lib/derive.ts` right after `bestPerKernel`:

```ts
/** A row's family; a kernel families() never saw counts as serial. */
export function familyOf(row: Row, family: Map<string, Family>): Family {
	return family.get(String(row.kernel)) ?? "serial";
}

/**
 * One row per (family, precision, n): the family's best row, whatever kernel,
 * thread count or block size produced it. The whole winning row is kept so a
 * family chart can name the kernel behind each point. Precision is part of
 * the key because the Precision tab passes every precision at once. A strict
 * `>` keeps the first row on a tie, so the result is stable.
 */
export function bestPerFamily(
	rows: Row[],
	family: Map<string, Family>,
): Row[] {
	const best = new Map<string, Row>();
	for (const r of rows) {
		const key = `${familyOf(r, family)}\u0000${r.precision}\u0000${r.n}`;
		const current = best.get(key);
		if (!current || Number(r.gops) > Number(current.gops)) best.set(key, r);
	}
	return [...best.values()];
}
```

Run: `cd web && bun test src/lib/derive.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing chart tests**

In `web/src/lib/charts/overview.test.ts`:
- Remove the `UNPALETTED_FILL` import and delete the whole test "a kernel outside the palette still gets a visible, defined fill when it wins a size".
- Add `throughputByFamily` to the `./overview` import.
- In "no rows, no chart", add `expect(throughputByFamily([], f, makeCtx([]))).toBeNull();`.
- Append:

```ts
const acrossFamilies: Row[] = [
	row({ kernel: "ikj", n: 256, gops: 26 }),
	row({ kernel: "ikj", n: 512, gops: 27 }),
	row({ kernel: "rayon-ikj", n: 256, threads: 4, gops: 151 }),
	row({ kernel: "rayon-ikj", n: 512, threads: 4, gops: 174 }),
	row({ kernel: "accelerate-blas", n: 256, gops: 906, backend: "amx" }),
	row({ kernel: "accelerate-blas", n: 512, gops: 1968, backend: "amx" }),
	row({ kernel: "metal-tiled", n: 256, gops: 97, backend: "metal" }),
	row({ kernel: "metal-tiled", n: 512, gops: 268, backend: "metal" }),
	row({ kernel: "mps", n: 512, gops: 699, backend: "metal" }),
];

test("the family chart draws one line per family, in legend order and family ink", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(spec?.color?.domain).toEqual(["serial", "parallel", "amx", "gpu"]);
	expect(spec?.color?.range).toEqual([
		"#844da2",
		"#008300",
		"#3987e5",
		"#e66767",
	]);
});

test("each family point names the kernel that won it", () => {
	const spec = throughputByFamily(acrossFamilies, f, makeCtx(acrossFamilies));
	const dots = spec?.marks?.[1] as
		| { data: { family: string; n: number; kernel: string }[] }
		| undefined;
	const gpuAt = (n: number) =>
		dots?.data.find((d) => d.family === "gpu" && d.n === n)?.kernel;
	expect(gpuAt(256)).toBe("metal-tiled");
	expect(gpuAt(512)).toBe("mps");
});

test("fastest-per-size cells are filled by family, so every winner has a colour", () => {
	const withUnknown: Row[] = [
		...acrossFamilies,
		row({ kernel: "packed-simd", n: 256, gops: 5000 }),
	];
	const spec = fastestPerSize(withUnknown, f, makeCtx(withUnknown));
	const color = spec?.color as { domain: string[]; range: string[] };
	// packed-simd (serial) wins 256, accelerate-blas (amx) wins 512.
	expect(color.domain).toEqual(["serial", "amx"]);
	expect(color.range).toEqual(["#844da2", "#3987e5"]);
});

test("the CPU & AMX size chart never draws a GPU kernel", () => {
	const spec = throughputVsSize(acrossFamilies, f, makeCtx(acrossFamilies));
	expect(spec?.color?.domain).toEqual(
		expect.arrayContaining(["ikj", "rayon-ikj", "accelerate-blas"]),
	);
	expect(spec?.color?.domain).not.toContain("mps");
	expect(spec?.color?.domain).not.toContain("metal-tiled");
});
```

In `web/src/lib/charts/index.test.ts`:
- Replace the test "every tab declares its own controls" with:

```ts
test("every tab declares its own controls", () => {
	const tab = (id: string) => TABS.find((t) => t.id === id);
	expect(TABS.map((t) => t.id)).toEqual([
		"overview",
		"cpu",
		"threads",
		"precision",
		"gpu",
		"blocksize",
	]);
	expect(tab("overview")?.controls).toEqual(["precision"]);
	expect(tab("overview")?.inertBlockSize).toBe(true);
	expect(tab("cpu")?.controls).toEqual(["precision", "blockSize"]);
	expect(tab("precision")?.inertPrecision).toBe(true);
	expect(tab("blocksize")?.inertBlockSize).toBe(true);
});
```

- In the tests "a non-selected block size does not leak into a pinned chart" and "a row without a block size survives any block-size selection", change `TABS.find((t) => t.id === "overview")` to `TABS.find((t) => t.id === "cpu")` and rename the local variable `overview` to `cpu`. The CPU & AMX tab is the one that still scopes by block size.
- Append:

```ts
test("the Overview is a family view: it keeps every block size", () => {
	const twoBlockSizes: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, block_size: 32 }),
		row({ kernel: "tiled", n: 512, gops: 11, block_size: 32 }),
		row({ kernel: "tiled", n: 256, gops: 20, block_size: 64 }),
	];
	const overview = TABS.find((t) => t.id === "overview");
	if (!overview) throw new Error("no overview tab");
	const scoped = rowsForTab(
		overview,
		twoBlockSizes,
		"f32",
		32,
		makeCtx(twoBlockSizes),
	);
	expect(scoped).toHaveLength(3);
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/charts`
Expected: FAIL. `throughputByFamily` is not exported, there is no `cpu` tab, and the fastest-per-size domain is kernel names.

- [ ] **Step 6: Rewrite the Overview charts**

In `web/src/lib/charts/overview.ts`:

1. Replace the imports with:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import {
	BASELINE_KERNEL,
	bestPerFamily,
	bestPerKernel,
	familyOf,
	hasKernel,
} from "../derive";
import { FAMILY_INK, FAMILY_ORDER } from "../palette";
import {
	BASE,
	breakGaps,
	type ChartSpec,
	type Ctx,
	log2Ticks,
	type PlotSpec,
} from "./types";
```

2. In `sizeSeries`, delete the comment block and the two lines that declare `otherLine` and `mpsLine`. Replace the two `Plot.line(otherLine, …)` / `Plot.line(mpsLine, …)` marks with one:

```ts
			Plot.line(lineData, {
				x: "n",
				y: "y",
				stroke: "kernel",
				strokeWidth: 2,
			}),
```

3. Replace `throughputVsSize` with:

```ts
/**
 * Per-kernel view of the host group only. GPU kernels are compared on the
 * GPU tab and folded into the Overview's family lines: a chart never draws
 * kernels from both colour groups.
 */
export const throughputVsSize: ChartSpec = (rows, f, ctx) => {
	const host = rows.filter((r) => familyOf(r, ctx.family) !== "gpu");
	return sizeSeries(host, ctx, f.relative && canShowSpeedup(host));
};
```

4. Replace `fastestPerSize` with:

```ts
/**
 * Computed over every kernel, independent of any legend: it summarises the
 * data, not the current view. Filled by the winner's family, not its kernel
 * slot: the winner can come from either colour group, and family ink is the
 * set validated on all pairs, since any two families can end up side by side.
 */
export const fastestPerSize: ChartSpec = (rows, _f, ctx) => {
	const winners = new Map<number, Row>();
	for (const r of bestPerKernel(rows)) {
		const n = Number(r.n);
		const current = winners.get(n);
		if (!current || Number(r.gops) > Number(current.gops)) winners.set(n, r);
	}
	if (!winners.size) return null;

	const cells = [...winners.entries()].map(([n, r]) => ({
		n,
		kernel: String(r.kernel),
		family: familyOf(r, ctx.family),
		gops: Number(r.gops),
	}));
	const present = FAMILY_ORDER.filter((family) =>
		cells.some((c) => c.family === family),
	);

	return {
		...BASE,
		height: 120,
		x: { type: "band", label: "N" },
		y: { axis: null },
		color: {
			domain: present,
			range: present.map((family) => FAMILY_INK[family]),
			legend: true,
		},
		marks: [
			Plot.cell(cells, { x: "n", fill: "family" }),
			Plot.text(cells, {
				x: "n",
				text: (d: { kernel: string; gops: number }) =>
					`${d.kernel}\n${d.gops.toFixed(0)}`,
				fill: "#0e1012",
				fontSize: 11,
			}),
		],
	};
};
```

5. Append the family chart:

```ts
type FamilyPoint = {
	n: number;
	family: string;
	kernel: string;
	threads: number;
	gops: number;
};
type FamilyGapPoint = {
	n: number;
	family: string;
	kernel: null;
	threads: null;
	gops: null;
};

/**
 * One line per family: each family's best kernel, thread count and block size
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
 */
export const throughputByFamily: ChartSpec = (rows, _f, ctx) => {
	const points: FamilyPoint[] = bestPerFamily(rows, ctx.family).map((r) => ({
		n: Number(r.n),
		family: familyOf(r, ctx.family),
		kernel: String(r.kernel),
		threads: Number(r.threads),
		gops: Number(r.gops),
	}));
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// Plot draws a line straight through a size a family has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<FamilyPoint | FamilyGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.family,
		(family, n) => ({ n, family, kernel: null, threads: null, gops: null }),
	);
	const present = FAMILY_ORDER.filter((family) =>
		points.some((p) => p.family === family),
	);

	return {
		...BASE,
		// Direct labels below need room for the longest family name.
		marginRight: 100,
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: {
			domain: present,
			range: present.map((family) => FAMILY_INK[family]),
			legend: true,
		},
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "gops",
				stroke: "family",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "family", r: 4 }),
			// At most four series, so direct labels as well as the legend.
			Plot.text(
				points.filter((p) => p.n === sizes[sizes.length - 1]),
				{
					x: "n",
					y: "gops",
					text: "family",
					dx: 6,
					textAnchor: "start",
					fill: "#9aa1a8",
					fontSize: 11,
				},
			),
			Plot.tip(
				points,
				Plot.pointer({
					x: "n",
					y: "gops",
					title: (d: FamilyPoint) =>
						`${d.family} · ${d.kernel} · ${d.threads}T\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};
```

- [ ] **Step 7: Delete `UNPALETTED_FILL`**

In `web/src/lib/palette.ts`, delete the `UNPALETTED_FILL` constant and its doc comment. Nothing imports it now.

- [ ] **Step 8: Re-declare the tabs**

In `web/src/lib/charts/index.ts`:

1. Change the overview import to `import { fastestPerSize, serialOnly, throughputByFamily, throughputVsSize } from "./overview";`.
2. Replace the `inertBlockSize` doc comment on `Tab` with:

```ts
	/**
	 * Block size is not a dimension of this tab: no pills, and rowsForTab does
	 * not scope by it. Either block size is the x-axis (the Block size tab) or
	 * the tab shows each family's best configuration (Overview, Precision,
	 * GPU), the same way bestPerKernel takes the best thread count. A kernel
	 * measured at only one block size is exempted from scoping automatically,
	 * via `ctx.singleBlockSize` in `rowsForTab`. That's a property of the data,
	 * not something a tab should assert about itself, so it is never a reason
	 * to set this flag.
	 */
	inertBlockSize?: boolean;
```

3. Replace the `overview` entry in `TABS` with these two entries (Overview first, then the new tab, before `threads`):

```ts
	{
		id: "overview",
		label: "Overview",
		controls: ["precision"],
		inertBlockSize: true,
		panels: [
			{
				title: "Throughput by family",
				note: "Each family's best kernel, thread count and block size at every size · log–log · GPU timings are end-to-end (host copies included), like the CPU timings",
				spec: throughputByFamily,
			},
			{
				title: "Fastest kernel per size",
				note: "Computed over every kernel and coloured by the winner's family",
				spec: fastestPerSize,
			},
		],
	},
	{
		id: "cpu",
		label: "CPU & AMX",
		controls: ["precision", "blockSize"],
		panels: [
			{
				title: "Throughput vs matrix size",
				note: "Each kernel's best thread count, at the selected block size · log–log · band is ±1 stddev",
				spec: throughputVsSize,
			},
			{
				title: "Single-threaded kernels",
				note: "Loop order and cache blocking at the selected block size, rescaled away from the parallel kernels",
				spec: serialOnly,
			},
		],
	},
```

4. Replace the doc comment on `rowsForTab` with:

```ts
/**
 * The rows a tab actually renders. A tab with inertPrecision needs every
 * precision (precision is its x-axis); a tab with inertBlockSize needs every
 * block size (block size is its x-axis, or it shows each family's best
 * configuration). Every other tab is scoped to both selected values, except
 * for a kernel with only one distinct block size in the whole dataset: the
 * dimension doesn't vary for it, so a block-size selection must not filter it
 * away, whichever tab it appears on. A row with no block size (a kernel that
 * doesn't tile) is never filtered by a block-size selection either. This is
 * the single place scoping happens: visibility and rendering must agree, or a
 * tab can appear and then render nothing.
 */
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd web && bun test`
Expected: PASS, all suites.

- [ ] **Step 10: Lint and type gate**

Run: `cd web && bunx @biomejs/biome check --write src/lib && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: no Biome errors; the grep prints nothing.

- [ ] **Step 11: Commit**

```bash
git add web/src/lib/derive.ts web/src/lib/derive.test.ts web/src/lib/charts/overview.ts web/src/lib/charts/overview.test.ts web/src/lib/charts/index.ts web/src/lib/charts/index.test.ts web/src/lib/palette.ts
git commit -m "Draw the Overview by family and move per-kernel CPU charts to a CPU & AMX tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rebuild the GPU tab

**Files:**
- Modify: `web/src/lib/charts/gpu.ts` (full rewrite below)
- Modify: `web/src/lib/charts/index.ts` (GPU import and entry)
- Test: `web/src/lib/charts/gpu.test.ts` (full rewrite), `web/src/lib/charts/index.test.ts`

**Interfaces:**
- Consumes: `bestPerFamily`, `familyOf`, `bestPerKernel` (derive); `FAMILY_INK`, `REFERENCE_INK` (palette); row field `gpu_ms` (Task 1).
- Produces: `hasGpu(rows)` (unchanged), `COUNTERPART: Map<string, Family>`, and the `ChartSpec`s `gpuKernels`, `gpuEqualEffort`, `gpuCopyOverhead`. `gpuVsCpu` and `gpuRatio` are removed.

- [ ] **Step 1: Write the failing tests**

Replace `web/src/lib/charts/gpu.test.ts` with:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { row } from "../fixtures";
import { gpuCopyOverhead, gpuEqualEffort, gpuKernels, hasGpu } from "./gpu";
import { type Filters, makeCtx } from "./types";

const f: Filters = {
	precision: "f32",
	n: 512,
	kernel: "mps",
	blockSize: 32,
	relative: false,
};

// GPU rows as withEndToEnd emits them: the plain kernel name, end-to-end
// timings, and the GPU-only median as gpu_ms.
const gpu = (
	kernel: string,
	n: number,
	gops: number,
	median_ms: number,
	gpu_ms: number | null,
) => row({ kernel, n, gops, median_ms, gpu_ms, backend: "metal" });

const f32: Row[] = [
	gpu("metal-naive", 512, 184, 1.458, 1.381),
	gpu("metal-naive", 1024, 303, 7.099, 6.771),
	gpu("metal-tiled", 512, 268, 1.001, 0.829),
	gpu("metal-tiled", 1024, 500, 4.297, 3.976),
	gpu("mps", 512, 699, 0.384, 0.304),
	gpu("mps", 1024, 1675, 1.282, 0.995),
	row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 174 }),
	row({ kernel: "rayon-ikj", n: 1024, threads: 8, gops: 197 }),
	row({ kernel: "accelerate-blas", n: 512, gops: 1968, backend: "amx" }),
	row({ kernel: "accelerate-blas", n: 1024, gops: 1748, backend: "amx" }),
];

type Dot = {
	series: string;
	kernel: string;
	counterpart: string;
	n: number;
	gops: number | null;
	ratio: number;
	pct: number;
};
const marksData = (spec: ReturnType<typeof gpuKernels>, i: number) =>
	(spec?.marks?.[i] as { data: Dot[] } | undefined)?.data ?? [];

test("the GPU tab is present only with metal rows", () => {
	expect(hasGpu(f32)).toBe(true);
	expect(hasGpu(f32.filter((r) => r.backend !== "metal"))).toBe(false);
});

test("no GPU chart builds without metal rows", () => {
	const cpu = f32.filter((r) => r.backend !== "metal");
	const ctx = makeCtx(cpu);
	expect(gpuKernels(cpu, f, ctx)).toBeNull();
	expect(gpuEqualEffort(cpu, f, ctx)).toBeNull();
	expect(gpuCopyOverhead(cpu, f, ctx)).toBeNull();
});

test("the kernel chart draws each GPU kernel then both CPU references, in validated order", () => {
	const spec = gpuKernels(f32, f, makeCtx(f32));
	expect(spec?.color?.domain).toEqual([
		"metal-naive",
		"metal-tiled",
		"mps",
		"AMX",
		"parallel CPU",
	]);
	expect(spec?.color?.range).toEqual([
		"#d95926",
		"#9085e9",
		"#e66767",
		"#3987e5",
		"#008300",
	]);
});

test("at an integer precision there is no AMX or mps, leaving three labelled series", () => {
	const i32 = [
		gpu("metal-naive", 512, 172, 1, 0.9),
		gpu("metal-naive", 1024, 317, 1, 0.9),
		gpu("metal-tiled", 512, 292, 1, 0.9),
		gpu("metal-tiled", 1024, 438, 1, 0.9),
		row({ kernel: "rayon-ikj", n: 512, threads: 8, gops: 177 }),
		row({ kernel: "rayon-ikj", n: 1024, threads: 8, gops: 205 }),
	].map((r) => ({ ...r, precision: "i32" }));
	const spec = gpuKernels(i32, { ...f, precision: "i32" }, makeCtx(i32));
	expect(spec?.color?.domain).toEqual([
		"metal-naive",
		"metal-tiled",
		"parallel CPU",
	]);
	// line, dot, direct labels, tip
	expect(spec?.marks).toHaveLength(4);
});

test("a GPU kernel missing a size gets an explicit gap, not a line straight through it", () => {
	const ragged: Row[] = [
		...f32,
		gpu("metal-naive", 2048, 242, 1, 0.9),
		row({ kernel: "rayon-ikj", n: 2048, threads: 8, gops: 152 }),
	];
	const line = marksData(gpuKernels(ragged, f, makeCtx(ragged)), 0);
	expect(line.find((d) => d.series === "mps" && d.n === 2048)?.gops).toBeNull();
});

test("mps is divided by AMX and the shaders by the parallel CPU", () => {
	const dots = marksData(gpuEqualEffort(f32, f, makeCtx(f32)), 2);
	const at = (kernel: string, n: number) =>
		dots.find((d) => d.kernel === kernel && d.n === n);
	expect(at("mps", 1024)?.counterpart).toBe("accelerate-blas");
	expect(at("mps", 1024)?.ratio).toBeCloseTo(1675 / 1748);
	expect(at("metal-tiled", 512)?.counterpart).toBe("rayon-ikj");
	expect(at("metal-tiled", 512)?.ratio).toBeCloseTo(268 / 174);
});

test("a size the counterpart never ran contributes no point, never NaN", () => {
	const noAmxAt512 = f32.filter((r) => !(r.backend === "amx" && r.n === 512));
	const dots = marksData(
		gpuEqualEffort(noAmxAt512, f, makeCtx(noAmxAt512)),
		2,
	);
	expect(dots.some((d) => d.kernel === "mps" && d.n === 512)).toBe(false);
	expect(dots.every((d) => Number.isFinite(d.ratio))).toBe(true);
});

test("copy overhead is the share of end-to-end time outside the GPU dispatch", () => {
	const dots = marksData(gpuCopyOverhead(f32, f, makeCtx(f32)), 1);
	expect(
		dots.find((d) => d.kernel === "mps" && d.n === 512)?.pct,
	).toBeCloseTo(((0.384 - 0.304) / 0.384) * 100);
});

test("a GPU row without a GPU-only twin is left out of the overhead chart", () => {
	const noTwin = f32.map((r) => (r.kernel === "mps" ? { ...r, gpu_ms: null } : r));
	const dots = marksData(gpuCopyOverhead(noTwin, f, makeCtx(noTwin)), 1);
	expect(dots.some((d) => d.kernel === "mps")).toBe(false);
	expect(dots.some((d) => d.kernel === "metal-tiled")).toBe(true);
});
```

In `web/src/lib/charts/index.test.ts`:
- Change `import { gpuVsCpu } from "./gpu";` to `import { gpuKernels } from "./gpu";`.
- Delete the test "the GPU tab's CPU-family line pins to the selected block size, not the max across both" and append this in its place:

```ts
test("the GPU tab's CPU reference is the family's best block size", () => {
	// rayon-tiled is faster at block_size=64, the non-selected one. The GPU tab
	// is a family view (inertBlockSize), so its parallel reference is the
	// family's best configuration whatever the hidden selection says. This
	// reverses cc5b136's pin to the selection (see the spec).
	const rows: Row[] = [
		row({ kernel: "mps", n: 256, gops: 93, backend: "metal" }),
		row({ kernel: "mps", n: 512, gops: 738, backend: "metal" }),
		row({ kernel: "rayon-tiled", n: 256, threads: 4, gops: 40, block_size: 32 }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 45, block_size: 32 }),
		row({ kernel: "rayon-tiled", n: 256, threads: 4, gops: 60, block_size: 64 }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 70, block_size: 64 }),
	];
	const gpu = TABS.find((t) => t.id === "gpu");
	expect(gpu?.inertBlockSize).toBe(true);
	if (!gpu) return;
	const ctx = makeCtx(rows);
	const scoped = rowsForTab(gpu, rows, "f32", 32, ctx);
	const spec = gpuKernels(scoped, { ...f, blockSize: 32 }, ctx);
	const line = spec?.marks?.[0] as
		| { data: { series: string; n: number; gops: number | null }[] }
		| undefined;
	expect(
		line?.data.find((d) => d.series === "parallel CPU" && d.n === 256)?.gops,
	).toBe(60);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/charts`
Expected: FAIL, because `gpuKernels`, `gpuEqualEffort` and `gpuCopyOverhead` are not exported.

- [ ] **Step 3: Rewrite `gpu.ts`**

Replace `web/src/lib/charts/gpu.ts` with:

```ts
import * as Plot from "@observablehq/plot";
import type { Row } from "../db";
import {
	bestPerFamily,
	bestPerKernel,
	type Family,
	familyOf,
} from "../derive";
import { FAMILY_INK, REFERENCE_INK } from "../palette";
import { BASE, breakGaps, type ChartSpec, type Ctx, log2Ticks } from "./types";

export function hasGpu(rows: Row[]): boolean {
	return rows.some((r) => r.backend === "metal");
}

/**
 * The CPU family each GPU kernel is measured against at equal engineering
 * effort: vendor library against vendor library (mps against Accelerate on
 * AMX), hand-written against hand-written (the shaders against the parallel
 * CPU kernels). Nothing in the data marks mps as a vendor library, since all
 * three GPU kernels are backend "metal", so like BASELINE_KERNEL this is keyed
 * by name. A Map, not an object literal: kernel names come from contributed
 * CSVs, and "constructor" must not resolve to a prototype member.
 */
export const COUNTERPART = new Map<string, Family>([["mps", "amx"]]);
const counterpartOf = (kernel: string): Family =>
	COUNTERPART.get(kernel) ?? "parallel";

/** The CPU-side reference lines drawn beside the GPU kernels, in legend order. */
const REFERENCES: { family: Family; label: string }[] = [
	{ family: "amx", label: "AMX" },
	{ family: "parallel", label: "parallel CPU" },
];

type Point = {
	n: number;
	series: string;
	kernel: string;
	threads: number;
	gops: number;
};
type GapPoint = {
	n: number;
	series: string;
	kernel: null;
	threads: null;
	gops: null;
};

const toPoint = (series: string, r: Row): Point => ({
	n: Number(r.n),
	series,
	kernel: String(r.kernel),
	threads: Number(r.threads),
	gops: Number(r.gops),
});

/** Each GPU kernel's best row at each size; rows are end-to-end (withEndToEnd). */
function gpuPoints(rows: Row[], ctx: Ctx): Point[] {
	return bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" && ctx.palette.has(String(r.kernel)),
		)
		.map((r) => toPoint(String(r.kernel), r));
}

/** A family's best row at each size, keyed by n. */
function familyBest(rows: Row[], ctx: Ctx, family: Family): Map<number, Row> {
	return new Map(
		bestPerFamily(rows, ctx.family)
			.filter((r) => familyOf(r, ctx.family) === family)
			.map((r): [number, Row] => [Number(r.n), r]),
	);
}

/**
 * Each GPU kernel against the best parallel-CPU and AMX result at every size.
 * GPU rows carry end-to-end timings, the same host-to-host scope as the CPU
 * rows, so every line is solid.
 */
export const gpuKernels: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	if (!kernelPoints.length) return null;
	const referencePoints = REFERENCES.flatMap(({ family, label }) =>
		[...familyBest(rows, ctx, family).values()].map((r) => toPoint(label, r)),
	);
	const points = [...kernelPoints, ...referencePoints];
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	// The validated legend order: GPU kernels (metal-naive, metal-tiled, mps
	// sort that way), then the references.
	const kernels = [...new Set(kernelPoints.map((p) => p.series))].sort();
	const references = REFERENCES.filter(({ label }) =>
		referencePoints.some((p) => p.series === label),
	);
	const present = [...kernels, ...references.map((r) => r.label)];
	const range = [
		...kernels.map((k) => ctx.palette.get(k) as string),
		...references.map((r) => FAMILY_INK[r.family]),
	];
	const showLabels = present.length <= 4;

	// Plot draws a line straight through a size a series has no row for;
	// break it instead of implying a measurement nobody took.
	const lineData = breakGaps<Point | GapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.series,
		(series, n) => ({ n, series, kernel: null, threads: null, gops: null }),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "GOP/s", labelAnchor: "top" },
		color: { domain: present, range, legend: true },
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "gops",
				stroke: "series",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "gops", fill: "series", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "gops",
								text: "series",
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
					x: "n",
					y: "gops",
					title: (d: Point) =>
						d.series === d.kernel
							? `${d.kernel}\n${d.gops.toFixed(1)} GOP/s`
							: `${d.series}: ${d.kernel} · ${d.threads}T\n${d.gops.toFixed(1)} GOP/s`,
				}),
			),
		],
	};
};

type RatioPoint = {
	n: number;
	kernel: string;
	counterpart: string;
	threads: number;
	ratio: number;
};
type RatioGapPoint = {
	n: number;
	kernel: string;
	counterpart: null;
	threads: null;
	ratio: null;
};

/**
 * Each GPU kernel divided by the best row of its COUNTERPART family at the
 * same size: where the GPU wins for the same engineering effort.
 */
export const gpuEqualEffort: ChartSpec = (rows, _f, ctx) => {
	const kernelPoints = gpuPoints(rows, ctx);
	const best = new Map(
		[...new Set(kernelPoints.map((p) => counterpartOf(p.kernel)))].map(
			(family) => [family, familyBest(rows, ctx, family)] as const,
		),
	);
	const points: RatioPoint[] = kernelPoints.flatMap((p) => {
		const cpu = best.get(counterpartOf(p.kernel))?.get(p.n);
		// A size the counterpart never ran is a gap, never a NaN point.
		if (!cpu) return [];
		const ratio = p.gops / Number(cpu.gops);
		if (!Number.isFinite(ratio)) return [];
		return [
			{
				n: p.n,
				kernel: p.kernel,
				counterpart: String(cpu.kernel),
				threads: Number(cpu.threads),
				ratio,
			},
		];
	});
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.kernel))].sort();
	const showLabels = present.length <= 4;
	const lineData = breakGaps<RatioPoint | RatioGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.kernel,
		(kernel, n) => ({
			n,
			kernel,
			counterpart: null,
			threads: null,
			ratio: null,
		}),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		y: { type: "log", label: "× vs CPU at equal effort", labelAnchor: "top" },
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			Plot.ruleY([1], { stroke: REFERENCE_INK, strokeDasharray: "5 5" }),
			Plot.line(lineData, {
				x: "n",
				y: "ratio",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "ratio", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "ratio",
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
					x: "n",
					y: "ratio",
					title: (d: RatioPoint) =>
						`${d.kernel} ÷ ${d.counterpart} · ${d.threads}T\n${d.ratio.toFixed(2)}×`,
				}),
			),
		],
	};
};

type OverheadPoint = { n: number; kernel: string; pct: number };
type OverheadGapPoint = { n: number; kernel: string; pct: null };

/**
 * The share of end-to-end time spent outside the GPU dispatch: copying the
 * inputs in, encoding, and copying the result out. Copies grow as N² and
 * arithmetic as N³, so the share falls at large sizes.
 */
export const gpuCopyOverhead: ChartSpec = (rows, _f, ctx) => {
	// The same best-per-(kernel, n) rows the kernel chart plots. A row with no
	// GPU-only twin (gpu_ms null) has nothing to subtract, so it is skipped.
	const points: OverheadPoint[] = bestPerKernel(rows)
		.filter(
			(r) =>
				familyOf(r, ctx.family) === "gpu" &&
				r.gpu_ms != null &&
				ctx.palette.has(String(r.kernel)),
		)
		.map((r) => ({
			n: Number(r.n),
			kernel: String(r.kernel),
			pct:
				((Number(r.median_ms) - Number(r.gpu_ms)) / Number(r.median_ms)) * 100,
		}))
		.filter((p) => Number.isFinite(p.pct));
	const sizes = log2Ticks(points.map((p) => p.n));
	if (sizes.length < 2) return null;

	const present = [...new Set(points.map((p) => p.kernel))].sort();
	const showLabels = present.length <= 4;
	const lineData = breakGaps<OverheadPoint | OverheadGapPoint>(
		points,
		sizes,
		(p) => p.n,
		(p) => p.kernel,
		(kernel, n) => ({ n, kernel, pct: null }),
	);

	return {
		...BASE,
		...(showLabels ? { marginRight: 100 } : {}),
		x: { type: "log", base: 2, ticks: sizes, tickFormat: String, label: "N" },
		// Includes 0 so the share reads against a true baseline, but is never
		// clamped there: a negative share in contributed data stays visible.
		y: {
			type: "linear",
			zero: true,
			label: "% of end-to-end time",
			labelAnchor: "top",
		},
		color: {
			domain: present,
			range: present.map((k) => ctx.palette.get(k) as string),
			legend: true,
		},
		marks: [
			Plot.line(lineData, {
				x: "n",
				y: "pct",
				stroke: "kernel",
				strokeWidth: 2,
			}),
			Plot.dot(points, { x: "n", y: "pct", fill: "kernel", r: 4 }),
			...(showLabels
				? [
						Plot.text(
							points.filter((p) => p.n === sizes[sizes.length - 1]),
							{
								x: "n",
								y: "pct",
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
					x: "n",
					y: "pct",
					title: (d: OverheadPoint) =>
						`${d.kernel}\n${d.pct.toFixed(1)}% copies + encoding`,
				}),
			),
		],
	};
};
```

- [ ] **Step 4: Re-declare the GPU tab**

In `web/src/lib/charts/index.ts`:
- Change `import { gpuRatio, gpuVsCpu } from "./gpu";` to `import { gpuCopyOverhead, gpuEqualEffort, gpuKernels } from "./gpu";`.
- Replace the `gpu` entry in `TABS` with:

```ts
	{
		id: "gpu",
		label: "GPU",
		controls: ["precision"],
		inertBlockSize: true,
		panels: [
			{
				title: "GPU kernels vs CPU",
				note: "GPU timings are end-to-end (host copies and command encoding included), like the CPU timings · references are each family's best kernel, thread count and block size",
				spec: gpuKernels,
			},
			{
				title: "GPU ÷ CPU at equal effort",
				note: "Hand-written shaders against the best hand-written parallel CPU kernel, MPS against the best AMX (Accelerate) kernel · above 1.0 the GPU wins",
				spec: gpuEqualEffort,
			},
			{
				title: "Copy overhead",
				note: "Share of end-to-end time spent copying inputs in, encoding, and copying the result out · copies grow as N², arithmetic as N³",
				spec: gpuCopyOverhead,
			},
		],
	},
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test`
Expected: PASS, all suites. This includes "the GPU tab survives selecting a block size mps does not have" and "the GPU tab is absent for a precision the GPU never ran", both unchanged.

- [ ] **Step 6: Lint and type gate**

Run: `cd web && bunx @biomejs/biome check --write src/lib && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: no Biome errors; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/charts/gpu.ts web/src/lib/charts/gpu.test.ts web/src/lib/charts/index.ts web/src/lib/charts/index.test.ts
git commit -m "Rebuild the GPU tab around end-to-end, equal-effort and copy-overhead views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Precision bars by family

**Files:**
- Modify: `web/src/lib/charts/precision.ts` (full rewrite below)
- Modify: `web/src/lib/charts/index.ts` (precision entry)
- Test: `web/src/lib/charts/precision.test.ts`, `web/src/lib/charts/index.test.ts`

**Interfaces:**
- Consumes: `bestPerFamily`, `familyOf` (Task 3); `FAMILY_INK`, `FAMILY_ORDER` (Task 2).
- Produces: `throughputByPrecision: ChartSpec` (same name, now one bar per family).

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/charts/precision.test.ts`, keep the first three tests ("builds when two precisions exist", "one precision is not a comparison", "ordered by descending best throughput"). Replace the last two tests with:

```ts
test("one bar per family, in legend order and family ink", () => {
	const spec = throughputByPrecision(rows, f, makeCtx(rows));
	expect(spec?.color?.domain).toEqual(["serial", "parallel"]);
	expect(spec?.color?.range).toEqual(["#844da2", "#008300"]);
});

test("a row at a different size does not leak into the pinned size", () => {
	// A missing `f.n` filter would let this n=128 row's huge gops win the
	// serial bar at i64 over the real n=64 ikj result (6).
	const multiSize: Row[] = [
		...rows,
		row({ kernel: "ikj", precision: "i64", n: 128, gops: 999 }),
	];
	const spec = throughputByPrecision(multiSize, f, makeCtx(multiSize));
	const bars =
		(
			spec?.marks?.[0] as
				| { data: { family: string; precision: string; gops: number }[] }
				| undefined
		)?.data ?? [];
	const serialAtI64 = bars.find(
		(b) => b.family === "serial" && b.precision === "i64",
	);
	expect(serialAtI64?.gops).toBe(6);
});

test("the i32 group has a GPU bar and no AMX bar", () => {
	const mixed: Row[] = [
		row({ kernel: "accelerate-blas", n: 64, gops: 400, backend: "amx" }),
		row({ kernel: "rayon-ikj", n: 64, threads: 4, gops: 27 }),
		row({
			kernel: "rayon-ikj",
			precision: "i32",
			n: 64,
			threads: 4,
			gops: 27,
		}),
		row({
			kernel: "metal-tiled",
			precision: "i32",
			n: 64,
			gops: 2,
			backend: "metal",
		}),
	];
	const spec = throughputByPrecision(mixed, f, makeCtx(mixed));
	const bars =
		(
			spec?.marks?.[0] as
				| { data: { family: string; precision: string }[] }
				| undefined
		)?.data ?? [];
	const at = (p: string) =>
		bars
			.filter((b) => b.precision === p)
			.map((b) => b.family)
			.sort();
	expect(at("i32")).toEqual(["gpu", "parallel"]);
	expect(at("f32")).toEqual(["amx", "parallel"]);
});
```

In `web/src/lib/charts/index.test.ts`, append:

```ts
test("the Precision tab is a family view pinned only by size", () => {
	const precision = TABS.find((t) => t.id === "precision");
	expect(precision?.controls).toEqual(["n"]);
	expect(precision?.inertBlockSize).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/charts`
Expected: FAIL. The legend domain is kernel names, and the precision tab still declares `blockSize`.

- [ ] **Step 3: Rewrite `precision.ts`**

Replace `web/src/lib/charts/precision.ts` with:

```ts
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
```

- [ ] **Step 4: Re-declare the Precision tab**

In `web/src/lib/charts/index.ts`, replace the `precision` entry with:

```ts
	{
		id: "precision",
		label: "Precision",
		controls: ["n"],
		inertPrecision: true,
		inertBlockSize: true,
		panels: [
			{
				title: "Throughput by precision",
				note: "Each family's best kernel, thread count and block size at the selected size · GPU timings are end-to-end",
				spec: throughputByPrecision,
			},
		],
	},
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test`
Expected: PASS, all suites.

- [ ] **Step 6: Lint and type gate**

Run: `cd web && bunx @biomejs/biome check --write src/lib && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: no Biome errors; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/charts/precision.ts web/src/lib/charts/precision.test.ts web/src/lib/charts/index.ts web/src/lib/charts/index.test.ts
git commit -m "Compare precisions by family so the GPU's integer lead shows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: README and data rebuild

**Files:**
- Modify: `README.md:217`

**Interfaces:**
- Consumes: the finished dashboard from Tasks 1–5.
- Produces: docs that match the six tabs; a rebuilt `web/public/results.parquet` (gitignored, not committed).

- [ ] **Step 1: Update the Web Dashboard paragraph**

In `README.md`, replace the paragraph that starts "It loads `web/public/results.parquet`" with:

```markdown
It loads `web/public/results.parquet` into DuckDB-WASM in the browser and charts it with [Observable Plot](https://observablehq.com/plot/) in six tabs: Overview (one line per kernel family), CPU & AMX, CPU threading, Precision, GPU, and Block size. Pickers narrow each tab by precision, matrix size, block size, or kernel, and a Relative toggle switches to speedup (over `naive-ijk` on CPU & AMX, over one thread on CPU threading). GPU kernels are charted with their end-to-end (`-e2e`) timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the GPU-only share as copy overhead. Charts that span kernel families colour by family, and per-kernel charts show either host or GPU kernels, never both. Chart definitions live in `web/src/lib/charts/`, each with a `bun test` suite next to it.
```

- [ ] **Step 2: Rebuild the data and run everything**

Run: `just data && just test-web && cd web && bunx @biomejs/biome check src && bun run check 2>&1 | grep ERROR | grep -v '\.test\.ts'`
Expected: `just data` succeeds (the Parquet file now contains the `mps-e2e` rows from 8f869a9), every web test passes, Biome reports no errors, and the grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the six dashboard tabs and end-to-end GPU timing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller Verification (after Task 6, not delegated)

1. `preview_start` with `name: "dashboard"`. Walk Overview, CPU & AMX, CPU threading, Precision, GPU and Block size at `f32`, then Overview, Precision and GPU at `i32`. Read the console after each tab.
2. Check against the spec's expected values: f32 GPU ÷ CPU at equal effort, `metal-tiled` 1.43 / 2.53 / 3.57 / 3.48 and `mps` 0.36 / 0.96 / 1.55 / 1.60 at N = 512 / 1024 / 2048 / 4096. Copy overhead: `metal-*` 0.6–17 %, `mps` 4–22 %.
3. Take a screenshot of Overview and GPU at `f32` and GPU at `i32`.
4. Re-run the dataviz validator for the family ink (`--pairs all`), the five-series GPU set and the three-kernel set (dark, `#15181b`), and match the numbers quoted in `palette.ts`.

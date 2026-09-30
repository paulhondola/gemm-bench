# Dashboard HPC Metrics Implementation Plan

> **For agentic workers:** Implement one task at a time, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends in one commit; the orchestrator reviews it and pushes.

**Goal:** Give the dashboard a denominator (hardware-peak ceilings and `% of peak` on hover), a headline (the optimization ladder on the Overview), and the accuracy half of the precision story (an accuracy-vs-throughput scatter on the Precision tab).

**Architecture:**
- Hand-curated peaks live in `data/peaks.csv`. `data/build.sql` validates them, failing the build on any bad value, and writes `web/public/peaks.json` next to `results.json`.
- The dashboard loads both files. The peaks go into `Ctx`, and `familyPeak` in `derive.ts` owns the rule mapping a family to its ceiling.
- Charts stay pure `(rows, filters, ctx) → Figure | null` functions, each with a `bun test` suite.

**Tech Stack:** DuckDB CLI (`data/build.sql`), Bun + Vite + Svelte 5 + TypeScript + Plotly.js 4.1.1 (`web/`), Biome, `just`, lefthook.

**Spec:** `docs/superpowers/specs/2026-09-30-dashboard-hpc-metrics-design.md`. Read it before starting any task: it holds the values, the rules and the reasons.

## Global Constraints

- Run commands from the repo root through `just`: `just check && just test` before every commit, and `just data` after touching `data/`. `just lint` auto-fixes Biome formatting (tabs, double quotes).
- Lefthook runs fmt/clippy/test/Biome/typecheck/data-build on commit. Never pass `--no-verify`.
- End every commit message with these two lines, after a blank line:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W53drfJzZhk3PHfRMzZD2A
  ```
- Commit, don't push: the orchestrator reviews and pushes.
- Never hand-edit `data/runs/**`.
- **Match the surrounding code:** comment density and voice (comments say *why*), naming, `Map` over object literals for anything keyed by a contributed name, and a strict `>` for stable tie-breaks. Touch only what the task needs.
- **Colours:** only `FAMILY_INK`, `BASELINE_INK`, `LABEL_INK` and `REFERENCE_INK` (`web/src/lib/palette.ts`, `web/src/lib/charts/types.ts`). Never add a hue.
- **Contributed strings stay in escaped fields.** Kernel, precision and device names come from contributed CSVs and may only appear in a trace's `name`, `text`, `customdata` or `x`, which `escapeLabels` escapes. Layout annotations, shape labels, `legendgrouptitle` and y-axis category labels are not escaped, so they carry only the dashboard's own strings.
- **A chart that can't be built returns `null`:** that hides the panel, and a tab with no buildable panel.

## File Map

| File | Change |
| :--- | :--- |
| `data/peaks.csv` | New: 8 hand-curated ceilings |
| `data/build.sql` | Read, validate and export peaks |
| `web/.gitignore` | Ignore `public/peaks.json` |
| `lefthook.yml` | `data-build` also fires on `data/peaks.csv` |
| `web/src/lib/db.ts` | `Peak`, `loadPeaks()` |
| `web/src/lib/state.svelte.ts` | `store.peaks`; boot loads both files |
| `web/src/lib/derive.ts`, `derive.test.ts` | `familyPeak`; `bestPerKernel` keyed by precision |
| `web/src/lib/fixtures.ts` | `row()` defaults `device`; `peak()` helper |
| `web/src/lib/charts/types.ts`, `types.test.ts` | `Ctx.peaks`, `makeCtx(allRows, peaks = [])`, ceiling helpers |
| `web/src/App.svelte` | `makeCtx(store.rows, store.peaks)` |
| `web/src/lib/charts/overview.ts`, `overview.test.ts` | Ceilings on `throughputByFamily`; `optimizationLadder` |
| `web/src/lib/charts/gpu.ts`, `gpu.test.ts` | Ceilings on `gpuKernels` |
| `web/src/lib/charts/precision.ts`, `precision.test.ts` | `accuracyVsThroughput` |
| `web/src/lib/charts/index.ts`, `index.test.ts` | Register the two new panels; notes |
| `README.md`, `CLAUDE.md`, `.claude/agents/dashboard-designer.md` | Docs |

---

### Task 1: `data/peaks.csv`, its validation, and `peaks.json`

**Files:**
- Create: `data/peaks.csv`
- Modify: `data/build.sql`, `web/.gitignore`, `lefthook.yml`

**Produces:**
- `web/public/peaks.json`, an array of `{device, backend, precision, cores, gflops, source}` sorted by `device, backend, precision, cores`.
- `just data` fails on any invalid peaks row, naming it, and writes neither JSON file when it fails.

- [ ] **Step 1: Write `data/peaks.csv`**

Header `device,backend,precision,cores,gflops,source`, then the 8 rows of the spec's values table, in its order.
- Each `source` is double-quoted, states the derivation and cites every factor by URL (URLs in the spec's Sources list).
- CPU rows cite Dougall Johnson (FMA pipes) and AnandTech (clock). The 1-core rows say "3.228 GHz with one core active"; the 8-core rows say "3.036 GHz with 4 cores active in each P-cluster".
- Metal rows cite Philip Turner and state that f16 runs at the f32 rate.
- No double quotes inside a source.

- [ ] **Step 2: Set up the scratch checks**

`build.sql` uses repo-relative paths, so it is run from a scratch copy:

```bash
REPO=$(pwd)
T=$(mktemp -d) && mkdir -p "$T/data" "$T/web/public" && cp -r data/runs "$T/data/"
check() {
  rm -f "$T"/web/public/*.json
  cp "$1" "$T/data/peaks.csv"
  if (cd "$T" && duckdb -bail < "$REPO/data/build.sql") >/dev/null 2>"$T/err"; then
    echo "PASS $(ls "$T/web/public")"
  else
    echo "FAIL [$(ls "$T/web/public")] $(head -c 300 "$T/err")"
  fi
}
bad() { sed "$1" data/peaks.csv > "$T/$2.csv"; echo "$2: $(check "$T/$2.csv")"; }
```

- [ ] **Step 3: Run the checks before the change, to see the gaps**

```bash
echo "good: $(check data/peaks.csv)"
bad '2s/,206.592,/,nan,/'           nan-gflops
bad '2s/,206.592,/,inf,/'           inf-gflops
bad '2s/,206.592,/,0,/'             zero-gflops
bad '2s/,206.592,/,-1,/'            negative-gflops
bad '2s/,f16,1,/,f16,0,/'           zero-cores
bad '2s/,f16,1,/,f16,,/'            empty-cores
bad '2s/,"[^"]*"$/,/'               empty-source
bad '2s/,"[^"]*"$/,"   "/'          blank-source
bad '2s/,cpu,/,amx,/'               amx-backend
bad '2p'                            duplicate
bad '2s/^Apple M1 Pro,/Apple M1 Pr0,/' device-typo
bad '2s/,cpu,f16,/,cpu,f17,/'       precision-typo
bad '2s/,206.592,/,abc,/'           non-numeric
bad '1s/,gflops,/,gflop,/'          renamed-column
```

Expected now: every line `PASS` (build.sql ignores `peaks.csv`) and no `peaks.json`. After Step 4: `good` passes with `peaks.json results.json`, and every other line is `FAIL []`, meaning no JSON was written. Check each failure message names the offending row (or the column, for the read errors).

- [ ] **Step 4: Implement in `data/build.sql`**

Insert this block after the `_gpu_ms_misplaced` check and before the `COPY` comment. Keep both `COPY`s after it, so a failed check writes nothing:

1. `CREATE VIEW peaks AS SELECT * FROM read_csv('data/peaks.csv', header = true, types = {...})`, pinning all six columns (`cores` BIGINT, `gflops` DOUBLE, the rest VARCHAR).
   - A renamed or missing column must fail the read. Confirm `types` naming an absent column errors in this DuckDB version. If it doesn't, add an explicit check.
2. A check in the file's existing style (`CREATE TEMP TABLE _x AS SELECT error(...) FROM ... HAVING count(*) > 0`) for the invalid-row conditions in the spec.
   - The message names each offending row as `device/backend/precision/cores`.
   - A NULL field must not blank the message: use `coalesce` or `concat_ws`, since `||` with NULL yields NULL.
   - `trim(source) = ''` counts as empty.
3. A duplicate check on `(device, backend, precision, cores)`.
4. An unmatched check: peaks rows with no run row on `(device, backend, precision)`, via an anti-join against `SELECT DISTINCT device, backend, precision FROM runs`.
5. Comments explaining *why* each check exists, in the file's voice. Say that unlike run files, `peaks.csv` is hand-curated, so a bad value fails the build rather than becoming null.

After the existing `COPY`, add:

```sql
COPY (
  SELECT device, backend, precision, cores, gflops, source
  FROM peaks
  ORDER BY device, backend, precision, cores
) TO 'web/public/peaks.json' (FORMAT json, ARRAY true);
```

Update the header comment to say the build writes both files.

- [ ] **Step 5: Re-run Step 3's checks**

All as expected in Step 3. Then `just data` passes in the repo, and `web/public/peaks.json` holds 8 objects with numeric `cores` and `gflops`.

- [ ] **Step 6: Ignore the output and hook the input**
  - `web/.gitignore`: add `public/peaks.json` under the existing `public/results.json` comment, and make the comment cover both.
  - `lefthook.yml`: make `data-build` fire on `data/peaks.csv` as well as `data/runs/**/*.csv`. Check the list form lefthook 2 accepts, then verify: `lefthook run pre-commit --file data/peaks.csv` runs `data-build`, and `--file README.md` skips it.

- [ ] **Step 7: Commit**

`just check && just test && just data`, then commit `data/peaks.csv data/build.sql web/.gitignore lefthook.yml` with message "Validate hand-curated hardware peaks and export them as peaks.json" and a short body.

---

### Task 2: Load the peaks into `Ctx`

**Files:**
- Modify: `web/src/lib/db.ts`, `web/src/lib/state.svelte.ts`, `web/src/lib/derive.ts`, `web/src/lib/derive.test.ts`, `web/src/lib/fixtures.ts`, `web/src/lib/charts/types.ts`, `web/src/App.svelte`

**Consumes:** `peaks.json` from Task 1.

**Produces:**
- `db.ts`:
  ```ts
  /** A hardware ceiling, as data/build.sql writes them to public/peaks.json. */
  export interface Peak {
  	device: string;
  	backend: string;
  	precision: string;
  	cores: number;
  	gflops: number;
  	source: string;
  }
  export async function loadPeaks(): Promise<Peak[]>;
  ```
  `loadPeaks` uses the same fetch-and-throw pattern as `loadRows`. A small private `fetchJson` shared by both is fine.
- `derive.ts`:
  ```ts
  export function familyPeak(
  	peaks: Peak[],
  	family: Family,
  	device: string,
  	precision: string,
  ): Peak | undefined;
  ```
  - serial → the `cpu` row with `cores === 1`
  - parallel → the `cpu` row with the most cores, only if that is `> 1`
  - gpu → the `metal` row with the most cores
  - amx → `undefined`
  - Only rows matching `device` and `precision` count.
  - Its doc comment says why: AMX has no published peak; the P-core clock falls as cores wake, hence one row per core count (see the spec).
- `charts/types.ts`: `Ctx` gains `peaks: Peak[]`, and `makeCtx(allRows: Row[], peaks: Peak[] = [])`. The default keeps every existing test call unchanged.
- `state.svelte.ts`: `store.peaks: [] as Peak[]`. `boot()` awaits `Promise.all([loadRows(), loadPeaks()])`, and any error lands in `store.error` as today.
- `App.svelte`: `makeCtx(store.rows, store.peaks)`.
- `fixtures.ts`:
  - `row()` also defaults `device: "Apple M1 Pro"`. Every real row has a device; no existing test reads it.
  - Add `peak(fields: Partial<Peak>): Peak`, defaulting `device: "Apple M1 Pro"`, `backend: "cpu"`, `precision: "f32"`, `cores: 1`, `gflops: 100`, `source: "test"`.

- [ ] **Step 1: Write the failing tests** in `derive.test.ts`, using `peak()`:
  - serial takes the 1-core row, even when an 8-core row is listed first
  - parallel takes the widest `cpu` row
  - parallel with only a 1-core row → `undefined`
  - gpu takes the `metal` row, never a `cpu` one
  - amx → `undefined` even with `cpu` and `metal` rows present
  - another device → `undefined`
  - `i32` with only f32 rows → `undefined`
- [ ] **Step 2:** `cd web && bun test src/lib/derive.test.ts`. Expected: fails, `familyPeak` not exported.
- [ ] **Step 3: Implement** everything under Produces.
- [ ] **Step 4:** `just check && just test`: all green. Then `just dev`, open the page, and check the dashboard still loads and renders as before (no visual change yet).
- [ ] **Step 5: Commit** "Load hardware peaks into the chart context".

---

### Task 3: Ceiling lines and `% of peak` on hover

**Files:**
- Modify: `web/src/lib/charts/types.ts`, `types.test.ts`, `overview.ts`, `overview.test.ts`, `gpu.ts`, `gpu.test.ts`, `index.ts`

**Consumes:** `familyPeak`, `Ctx.peaks`, `fixtures.peak()` from Task 2.

**Produces** (in `charts/types.ts`):

```ts
export interface Ceiling {
	family: Family;
	gflops: number;
	/** The direct label: "1-core peak", "CPU peak (8 P)", "GPU peak". */
	label: string;
}

/**
 * The ceiling a family's plotted rows are measured against, or undefined
 * when there is none: no peak listed, or rows that span more than one
 * device or precision (contributed runs from several machines).
 */
export function ceilingOf(rows: Row[], family: Family, ctx: Ctx): Ceiling | undefined;

/** A dashed rule at the ceiling, in the family's ink, labelled at its left end. */
export function ceilingShape(c: Ceiling, legendgroup?: string): Partial<Shape>;

/** " · 24% of peak" to 2 significant figures, or "" without a ceiling. */
export function pctOfPeak(gops: number, c: Ceiling | undefined): string;
```

- `ceilingShape` returns:
  - `type: "line"`, `xref: "paper"`, `x0: 0`, `x1: 1`, `y0 = y1 = c.gflops`
  - `line: { color: FAMILY_INK[c.family], dash: "dash", width: 1.5 }`
  - `label: { text: c.label, textposition: "start", yanchor: "bottom", font: { color: LABEL_INK, size: 11 } }`
  - `legendgroup` only when given
- `pctOfPeak` computes `Number(((100 * gops) / c.gflops).toPrecision(2))`, so 24.46 → `24%` and 0.0452 → `0.045%`.
- The `Shape` type comes from `plotly.js-dist-min`.

**Chart changes:**
- **`throughputByFamily` (overview.ts):**
  - For each present family, `ceilingOf(<that family's bestPerFamily rows>, family, ctx)`.
  - `layout.shapes` gets one `ceilingShape(c, family)` per ceiling. `lineTraces` uses the series name as `legendgroup`, so hiding a family hides its ceiling.
  - Each point's `custom` gains a third field, `pctOfPeak(gops, <its family's ceiling>)`, and the hovertemplate appends `%{customdata[2]}` after the thread count.
  - No ceilings → no `shapes` key at all, so the figure is unchanged without peaks.
- **`gpuKernels` (gpu.ts):**
  - The GPU ceiling comes from all GPU kernel points' rows (family `gpu`, no legend group: it spans three kernel series).
  - The parallel ceiling comes from the parallel family-best rows, with legend group `"parallel CPU"` (the series name `lineTraces` gives that reference line).
  - AMX gets none.
  - Each point's `custom` gains `pctOfPeak` as a second field against its own series' ceiling (GPU kernels → GPU ceiling, "parallel CPU" → parallel, AMX → none), and the template appends `%{customdata[1]}`.
- **`index.ts`:** append to the notes of "Throughput by family" and "GPU kernels vs CPU": `· dashed lines are hardware peaks (data/peaks.csv), and hover gives % of peak; AMX has no published peak and the integer precisions no sourced one, so they have none`.

- [ ] **Step 1: Write the failing tests.**
  - `types.test.ts`: `pctOfPeak` (24.46%, 0.0452%, undefined → `""`); `ceilingShape` fields and optional `legendgroup`; `ceilingOf` label per family and `undefined` for rows on two devices.
  - `overview.test.ts`, extending `acrossFamilies` with peaks for serial/parallel/gpu:
    - three shapes in serial/parallel/gpu ink, each with its `legendgroup`
    - no shape for AMX
    - `makeCtx(rows)` without peaks → no `shapes`
    - an `i32` dataset → no `shapes`
    - hover custom `" · 26% of peak"` on a serial point with gops 26 and a 100 GFLOP/s peak
    - AMX points → `""`
    - serial rows on two devices → no serial shape and `""` hover, while the other families keep theirs
  - `gpu.test.ts`: shapes for GPU (no legend group) and parallel (`"parallel CPU"`); `mps` hover % against the GPU ceiling; AMX reference hover `""`.
- [ ] **Step 2:** Run the three files; the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `just check && just test`. Then `just dev` and look at Overview (f32, f16, f64, i32) and GPU (f32):
  - the lines sit at ≈103 / 777 / 5,308 at f32
  - the labels are legible and don't collide with the end-of-line series labels
  - the y-axis stretches to include the GPU line
  - hiding a family hides its line
  - i32 has no lines

  Fix anything that doesn't read well, and note what you checked in the commit body.
- [ ] **Step 5: Commit** "Draw hardware-peak ceilings and % of peak on the family and GPU charts".

---

### Task 4: Optimization ladder

**Files:**
- Modify: `web/src/lib/charts/overview.ts`, `overview.test.ts`, `index.ts`, `index.test.ts` (only if a test asserts the Overview's panels)

**Produces:** `export const optimizationLadder: ChartSpec` in `overview.ts`, registered as the first Overview panel:
- title `"Optimization ladder"`
- note: `"Each rung is the fastest result of the next technique up, at the largest N every rung measured · log scale · × is the step over the rung above"`

**Behaviour** (spec, "Optimization ladder"):

1. **Rungs:** `[{ label: BASELINE_KERNEL, family: null }, { label: "serial", family: "serial" }, { label: "parallel", … }, { label: "amx", … }, { label: "gpu", … }]`.
   - The `naive-ijk` rung's rows are `r.kernel === BASELINE_KERNEL`.
   - A family rung's rows are `familyOf(r, ctx.family) === family && r.kernel !== BASELINE_KERNEL`.
   - A rung with no rows is dropped.
2. **Size:** `n` is the largest size present in every remaining rung. Return `null` if fewer than 2 rungs remain or no size is shared.
3. **Values:** each rung's row is its highest-`gops` row at `n`, with the first row winning a tie.
4. **One bar trace** (`name`/`uid` `"ladder"`, `orientation: "h"`):
   - `x` = gops; `y` = rung labels
   - `marker.color` per bar: `BASELINE_INK` for `naive-ijk`, `FAMILY_INK[family]` otherwise
   - `text` per bar, `textposition: "outside"`, `cliponaxis: false`, `textfont: { color: LABEL_INK, size: 11 }`
   - `customdata` `[kernel, threads]`
   - hovertemplate `"<b>%{x:.1f} GOP/s</b>  %{customdata[0]} · %{customdata[1]}T<extra></extra>"`
5. **Bar text:** `` `${kernel} · ${fmtGops(g)} GOP/s` `` plus `` ` · ×${fmtX(g / previous)}` `` on every rung after the first, where:
   - `fmtGops(v)` = `v >= 100 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(3)))`
   - `fmtX(r)` = `Number(r.toPrecision(2)).toLocaleString("en-US")`
   - A step below 1 prints as it is (`×0.86`).
6. **Layout:**
   - `...BASE_LAYOUT`, `height: 260`, `showlegend: false`, `hovermode: "closest"`
   - a margin with room on the right for the outside text and at the top for the annotation. Tune it visually.
   - `xaxis`: `{ ...AXIS, type: "log", title: { text: "GOP/s" } }`
   - `yaxis`: `{ ...AXIS, type: "category", categoryorder: "array", categoryarray: labels, autorange: "reversed", fixedrange: true }`
   - one annotation (paper coordinates, top-left, `showarrow: false`, bold) reading `` `${fmtGops(first)} → ${fmtGops(last)} GOP/s · ${fmtX(last / first)}× at N = ${n}` ``. It holds no contributed strings.

- [ ] **Step 1: Write the failing tests** in `overview.test.ts`, with a fixture of one row per rung at two sizes (plus a parallel kernel at two thread counts):
  - labels in rung order
  - `n` is the largest shared size when one rung lacks the largest size
  - bar text multipliers, including a step below 1 (`×0.5`) when AMX beats the GPU
  - the ink per bar (`BASELINE_INK` first)
  - `naive-ijk` is not the serial rung (a dataset with only `naive-ijk` as serial → no serial bar)
  - no GPU rows → 4 rungs
  - no AMX rows → 4 rungs
  - the annotation text
  - `null` for one rung, for no shared size, and for `[]`
- [ ] **Step 2:** The new tests fail.
- [ ] **Step 3: Implement and register** the panel.
- [ ] **Step 4:** `just check && just test`. Then `just dev`, Overview at f32/f16/f64/i32:
  - f32 reads `naive-ijk 0.524 → ikj 25.7 (×49) → rayon-ikj 162 (×6.3) → accelerate-bnns 2,289 (×14) → mps 3,436 (×1.5)`, with the annotation `0.524 → 3,436 GOP/s · 6,600× at N = 4096`
  - the outside text isn't clipped
  - the annotation doesn't collide with the plot
- [ ] **Step 5: Commit** "Add the optimization ladder to the Overview".

---

### Task 5: Accuracy vs throughput

**Files:**
- Modify: `web/src/lib/derive.ts`, `derive.test.ts`, `web/src/lib/charts/precision.ts`, `precision.test.ts`, `index.ts`

**Produces:**
- **`bestPerKernel`:** its key becomes `` `${r.kernel}\u0000${r.precision}\u0000${r.n}` ``. Its doc comment explains that precision is part of the key because the Precision tab passes every precision at once, as `bestPerFamily`'s does.
- **`accuracyVsThroughput: ChartSpec`** in `precision.ts`, registered as the Precision tab's second panel:
  - title `"Accuracy vs throughput"`
  - note: `"Each kernel's fastest configuration at the selected size, float precisions only · error is the mean relative error against an f64 CPU reference · results equal to the reference (every integer kernel, and f64 CPU kernels, which add in the reference's order) and non-finite ones can't sit on a log axis, so they are left out"`

**Behaviour:**
1. **Symbols:** `const FLOAT_SYMBOL = new Map([["f16", "circle"], ["f32", "square"], ["f64", "diamond"]])`.
2. **Points:** `bestPerKernel(rows.filter((r) => Number(r.n) === f.n && FLOAT_SYMBOL.has(String(r.precision))))`, keeping only rows where `typeof r.mean_rel_error_f64 === "number" && r.mean_rel_error_f64 > 0`. Return `null` when none remain.
3. **Traces:** one per (family, precision) present, ordered by `FAMILY_ORDER` then `FLOAT_SYMBOL` order. Each has:
   - `type: "scatter"`, `mode: "markers"`, `name` = precision, `uid` = `uidOf(\`${family} ${precision}\`)`
   - `legendgroup` = family, `legendgrouptitle: { text: family }`
   - `x` = errors, `y` = gops, `customdata` `[kernel, threads]`
   - `marker: { color: FAMILY_INK[family], symbol, size: 10 }`
   - hovertemplate `"<b>%{customdata[0]}</b> · %{fullData.name} · %{customdata[1]}T<br>%{x:.2~e} mean relative error · %{y:.1f} GOP/s<extra></extra>"`
4. **Layout:**
   - `...BASE_LAYOUT`, `hovermode: "closest"`, `legend: { ...BASE_LAYOUT.legend, groupclick: "toggleitem" }`
   - `xaxis`: `{ ...AXIS, type: "log", exponentformat: "power", title: { text: "Mean relative error vs f64 reference" } }`
   - `yaxis`: `{ ...AXIS, type: "log", title: { text: "GOP/s" } }`

- [ ] **Step 1: Write the failing tests.**
  - `derive.test.ts`: `bestPerKernel` keeps one row per (kernel, precision, n), e.g. `ikj` f16 and f32 at n=64 → 2 rows.
  - `precision.test.ts`:
    - exact (`0`), `null` and integer rows dropped
    - one point per (kernel, precision), the fastest row's error
    - `f.n` pins the size
    - symbol per precision and ink per family
    - each trace's `legendgroup` and `name`
    - trace order
    - `null` when only exact results remain
- [ ] **Step 2:** The new tests fail.
- [ ] **Step 3: Implement and register.**
- [ ] **Step 4:** `just check && just test`. Then `just dev`, Precision at N=4096 and N=1024:
  - at 4096, f16 `mps` ≈ 1.3e-4 sits far left of f16 `accelerate-bnns` ≈ 1.7e-2 at similar GOP/s
  - the f16 CPU cluster sits at ≈ 6.6e-2 and the Metal shaders at ≈ 6.7e-2
  - f32 sits near 3e-7, and `accelerate-blas` f64 near 3e-18
  - the grouped legend renders legibly in one horizontal row. If it doesn't, stop and report; don't swap designs.
- [ ] **Step 5: Commit** "Chart accuracy against throughput on the Precision tab".

---

### Task 6: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.claude/agents/dashboard-designer.md`

- [ ] **Step 1: `README.md`**
  - **Benchmark Data:** a paragraph on `data/peaks.csv`: what it holds, one row per ceiling and why, that every row needs a cited `source`, that bad values fail the build, and that 14- and 16-core M1 Pro GPUs share a device string.
  - **Commands table, `just data` row:** it writes `results.json` and `peaks.json`, and a bad peaks row fails the build.
  - **Web Dashboard paragraph:** the ladder, the ceilings and `% of peak`, and the accuracy scatter, briefly, in the paragraph's existing style.
  - **Pre-commit hooks table:** `data/runs/**/*.csv` and `data/peaks.csv` → `duckdb -bail < data/build.sql`.
- [ ] **Step 2: `CLAUDE.md`, Gotchas:** one bullet saying `data/peaks.csv` is hand-curated hardware peaks, one row per ceiling, every row cites its source, and a bad value fails `just data`.
- [ ] **Step 3: `dashboard-designer.md`, "Data source" bullet:** add that `web/public/peaks.json` (from `data/peaks.csv`) is loaded beside it into `Ctx.peaks`.
- [ ] **Step 4: Commit** "Document hardware peaks and the new dashboard panels".

---

### Task 7 (orchestrator): End-to-end verification

- [ ] `just check && just test && just data`.
- [ ] `bun run build` and `bun run preview`. Take Playwright screenshots of:
  - Overview at f32, f16, f64 and i32
  - the GPU tab at f32
  - Precision at N=4096 and N=1024

  Check the plotted and hovered numbers against DuckDB queries over `web/public/results.json`.
- [ ] `/code-review` at high effort over `main...HEAD`; fix what it confirms.
- [ ] Push `feat/dashboard-hpc-metrics`.

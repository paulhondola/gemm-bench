# Dashboard Docs in Markdown: Per-Chart Explanations, Kernel Details, Hardware

- **Status:** Approved decisions (2026-09-30); plan in `docs/superpowers/plans/2026-09-30-dashboard-markdown-docs.md`.
- **Branch:** `claude/gracious-einstein-ywu39k`
- **Builds on:** the About tab MVP (`docs/superpowers/specs/2026-09-30-dashboard-about-tab-design.md`, commit `33380e2`). This spec replaces the MVP's `Tab.about` field, its About "Views" section and its `KERNEL_DOCS` TypeScript catalogue. Its placement decisions (About is last in the tab row, outside `TABS`, with no controls) stand.

## Problem

The MVP put all the documentation in TypeScript strings and on one page. Explaining a chart on the About tab, away from the chart, makes the reader switch tabs to learn how to read it. Meanwhile the captions under several chart titles have grown into paragraphs to carry the caveats. The About page also says nothing about the machine behind the numbers: what an M1 Pro is, and how close each engine gets to its peak.

## Decisions

| Question | Decision |
| :--- | :--- |
| Format | Markdown files, rendered in the dashboard. |
| Chart explanations | Each chart gets its own Markdown file, shown under the chart's title as a collapsible **How to read this chart**, closed by default. |
| Captions (panel notes) | Trimmed to one line: what's plotted, the scale, and anything needed to read the axes correctly. Everything else moves into the chart's Markdown, so nothing is said twice. |
| About page | Intro, then **Hardware tested**, then **Kernels**. The per-tab "Views" section goes, since each chart now explains itself. |
| Kernels | More detail than the MVP: a loop sketch, what it tunes, its precisions, caveats, and a link to its source file. |
| Machine | MacBook Pro 16-inch (2021), Apple M1 Pro (10-core CPU: 8 performance + 2 efficiency, 16-core GPU), 16 GB unified memory. |
| Peaks on the hardware entry | Each engine's peak from `peaks.json`, the fastest result in the runs, and the % of peak it reaches. AMX has no published peak, so it shows its best measured result only. |

## Goals

1. Every chart panel has an explanation in Markdown, opened from under its title.
2. Every caption is one line.
3. The About page shows the machine's specs with cited sources, and a table of peak vs best measured for 1 P-core, 8 P-cores, AMX and the GPU at `f16`, `f32` and `f64`.
4. The About page documents each kernel in more depth than the MVP.
5. The tests still tie the docs to the code:
   - every panel has a doc, and no chart doc is orphaned;
   - the kernel sections match `benchmark/src/kernel.rs`;
   - the hardware table's numbers come from a tested pure function.

## Non-Goals

- **Remembering which explanations were open.** Each panel is keyed, so switching tabs closes them again.
- **Equations.** No LaTeX in the Markdown. Formulas use Unicode (N³, √N, ε), since adding KaTeX would mean a second rendering dependency.
- **Prose for other machines.** `hardware.md` describes the M1 Pro that produced the published runs. The table covers every device in `peaks.json`, but only the M1 Pro gets a written spec entry.
- **Integer precisions in the hardware table.** They have no peaks, so the table is floats only.
- **An AMX peak.** None is added to `peaks.csv`; that decision stands from the HPC-metrics spec.
- **Checking kernel precisions against the code.** The docs state each kernel's precisions as static text. The drift test checks kernel names, not precisions.
- **The phone-width tab row.** A separate task.

## Design

### Where the Markdown lives, and how it's loaded

```
web/src/docs/
  about.md                  the About page's intro
  hardware.md               Hardware tested: machine specs, with sources
  charts/<panel>.md         one per chart panel (13), named after its title
  kernels/serial.md         one per family: a blurb, then "## `<kernel>`" sections
  kernels/parallel.md
  kernels/amx.md
  kernels/gpu.md
```

- **Under `web/src/`, not the repo's `docs/`.** Vite's dev server only serves files inside `web/`, so importing from outside it would mean widening `server.fs.allow`. The files still read normally on GitHub.
- **Imported as strings with `?raw`.** For example, `import ladder from "../../docs/charts/optimization-ladder.md?raw"`. This works in all three toolchains:
  - Vite handles it natively;
  - Bun supports it too (checked: `bun` resolves `./x.md?raw` to the file's text), so `bun test` can import `charts/index.ts` unchanged;
  - `vite/client`, already in `tsconfig.app.json`'s `types`, declares `*?raw` as `string`.
  `import.meta.glob` is ruled out: Bun doesn't support it.
- **Rendered with [`marked`](https://marked.js.org).** Its `parse` is synchronous and it has no dependencies. GFM tables are on by default. mdsvex would let Markdown embed Svelte components, but it swaps the build pipeline for one feature; the data-driven hardware table is a Svelte component placed after `hardware.md` instead.
- **Trusted input only.** The Markdown is first-party: committed, reviewed files. It goes into the page through `{@html}`. Contributed strings (kernel, precision and device names from CSVs) must never pass through `renderMarkdown`. Its doc comment says so, and CLAUDE.md gains a gotcha saying the same.

### `web/src/lib/markdown.ts`

```ts
/**
 * Markdown to HTML for the dashboard's own docs (web/src/docs). The output is
 * inserted with {@html}, unsanitized: never pass a contributed string here.
 * `headingOffset` demotes every heading, so a file's "##" sits under the
 * page's own headings.
 */
export function renderMarkdown(src: string, headingOffset = 0): string;
```

It keeps one `Marked` instance per offset, created on first use, whose `walkTokens` hook adds the offset to each heading's depth, capped at 6.

### Per-chart explanations

- `Panel` in `charts/index.ts` gains a required `doc: string`, the imported Markdown. A new panel without a doc fails the typecheck.
- `Chart.svelte` gains a `doc` prop. Under the header it renders `<details class="doc"><summary>How to read this chart</summary><div class="prose">{@html renderMarkdown(doc)}</div></details>`, with the HTML computed in a `$derived`. It renders whether or not the chart can be built, so the "No data for this selection." state still explains the chart.
- `App.svelte` passes `doc={panel.doc}`.
- `Tab.about` is removed.

**Chart files**, each named after its panel's title in kebab case: `optimization-ladder`, `throughput-by-family`, `fastest-kernel-per-size`, `throughput-vs-matrix-size`, `single-threaded-kernels`, `throughput-vs-thread-count`, `parallel-efficiency`, `throughput-by-precision`, `accuracy-vs-throughput`, `gpu-kernels-vs-cpu`, `gpu-vs-cpu-at-equal-effort`, `copy-overhead`, `throughput-vs-block-size`.

**Each chart file follows one shape.** There are no headings, so it reads the same on GitHub and under the toggle. It has up to three short paragraphs with bold lead-ins:

> **What it shows.** What is plotted, which rows it draws from (best thread count, best block size, which families), and what the axes are.
>
> **How to read it.** The comparison the chart is for, and what a good or bad result looks like.
>
> **Caveats.** Everything that leaves a caption (see below), plus the controls that do and don't apply.

The source material is the MVP's tab paragraphs (commit `33380e2`, `Tab.about`), the current captions, and the chart functions' doc comments. Numbers are never written into the Markdown, because they change with the data.

**Trimmed captions.** The final wording is settled in the plan. Each one keeps only what's needed to read the axes:

| Panel | Caption |
| :--- | :--- |
| Optimization ladder | Fastest result of each technique at the largest N every rung measured · log scale · × is the step over the rung above |
| Throughput by family | Each family's best result at every size · log–log · dashed lines are hardware peaks |
| Fastest kernel per size | The fastest kernel at each size, coloured by its family |
| Throughput vs matrix size | Each kernel's best thread count, at the selected block size · log–log · band is ±1 stddev |
| Single-threaded kernels | Single-threaded kernels only, at the selected block size |
| Throughput vs thread count | At the selected size and block size · linear axes |
| Parallel efficiency | Speedup ÷ threads for the selected kernel, at every size (the N pill doesn't apply) |
| Throughput by precision | Each family's best result at the selected size · GPU timings are end-to-end |
| Accuracy vs throughput | Each float kernel's fastest configuration at the selected size · log–log · exact results are left out |
| GPU kernels vs CPU | End-to-end GPU timings against the best threaded-CPU and AMX results · log–log · dashed lines are hardware peaks |
| GPU ÷ CPU at equal effort | Above 1.0 the GPU wins |
| Copy overhead | Share of end-to-end time spent outside the GPU's compute |
| Throughput vs block size | Kernels measured at more than one block size, at the selected size |

Every sentence that leaves a caption must appear in that chart's Markdown. The plan's review step checks this against the old captions.

### Kernels

- **`web/src/lib/docs.ts`** changes from the MVP's TypeScript catalogue to one import per family:
  ```ts
  export interface FamilyDoc {
  	family: Family;
  	/** The heading beside the family's legend name. */
  	title: string;
  	/** web/src/docs/kernels/<family>.md: a blurb, then one "## `<kernel>`" section per kernel. */
  	doc: string;
  }
  export const KERNEL_DOCS: FamilyDoc[]; // in FAMILY_ORDER
  ```
- **`About.svelte`** keeps the MVP's family heading (the `FAMILY_INK` dot, the legend name and the title) and renders the family's Markdown under it with `headingOffset` 2. The file's `##` becomes an `h4`, under About's `h2` "Kernels" and the family's `h3`.
- **Per-kernel template** (the MVP's "what" and "runs via" text is the starting point):

  ````md
  ## `ikj`

  What it does and why it's faster or slower than its neighbours (the MVP's "what", expanded).

  ```text
  for i in 0..N:
    for k in 0..N:
      a = A[i][k]
      for j in 0..N:
        C[i][j] += a * B[k][j]
  ```

  - **Runs via:** the MVP's "via".
  - **Tunes:** nothing / thread count / block size.
  - **Precisions:** from `KernelInfo` in `benchmark/src/kernel.rs`.
  - **Watch for:** its caveat, if any (below).
  - **Source:** [`benchmark/src/kernels/serial/ikj.rs`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/serial/ikj.rs)
  ````

  Sketches are at most about 8 lines of pseudo-code, not Rust:
  - the loop nest for the CPU kernels;
  - the partitioning for the parallel ones;
  - the library call for `accelerate-blas` (`cblas_sgemm(RowMajor, NoTrans, NoTrans, n, n, n, 1, A, n, B, n, 0, C, n)`);
  - the build-once, run-per-call shape for `accelerate-bnns`;
  - the encode call for `mps`;
  - the per-thread body of the shaders.

  Caveats to carry over from the README and the code:
  - `accelerate-*` rows record `threads = 1`, meaning one calling thread, while Accelerate threads internally.
  - `accelerate-bnns` accumulates `f16` in `f16`.
  - `metal-*` accumulate in the element type, and Apple GPUs emulate `i64` multiplies in software.
  - `metal-tiled`'s 16 × 16 tile is fixed and ignores `--block-size`, and it runs slower than `metal-naive` at `i64`.
  - `mps` has no `f64`, and the AMX is not reachable from it.
  - The `static-*` kernels need at least one row per thread.

### Hardware tested

**`web/src/docs/hardware.md`** has a short paragraph and a spec table. Every figure cites a source, the same rule as `peaks.csv`. A figure that can't be sourced is left out rather than written from memory.

| Part | Content | Source |
| :--- | :--- | :--- |
| Machine | MacBook Pro 16-inch (2021), 16 GB unified memory | You (the owner); Apple's tech specs page for the model |
| CPU | 10 cores: 8 performance (Firestorm) in two 4-core clusters, 2 efficiency (Icestorm). P-core clock 3.228 GHz with one core active, 3.036 GHz with every core in a cluster busy | AnandTech (already cited in `peaks.csv`) |
| CPU caches | Per P-core L1 data and instruction caches, L2 shared per cluster, system-level cache | AnandTech's M1 Pro/Max review; verify each figure |
| SIMD | 4 FMA pipes per P-core, 128-bit NEON | Dougall Johnson (already cited in `peaks.csv`) |
| AMX | A matrix coprocessor per CPU cluster, reachable only through Accelerate; Apple publishes no peak | corsix/amx or another cited source; verify |
| GPU | 16 cores × 128 ALUs, 1.296 GHz | Philip Turner (already cited in `peaks.csv`) |
| Memory | 16 GB LPDDR5, unified between CPU and GPU, 200 GB/s | Apple's tech specs; verify |
| OS | macOS 26 or later (`accelerate-bnns` needs it); the exact version if the owner supplies it | You (the owner) |

**The peak-vs-measured table** is `HardwareTable.svelte`, placed after `hardware.md` and computed from the data, never typed into Markdown. It is built by a pure function with a `bun test` suite:

```ts
/** web/src/lib/hardware.ts */
export interface EngineRow {
	device: string;
	/** "1 P-core", "8 P-cores", "AMX", "GPU (16 cores)": the dashboard's own strings. */
	engine: string;
	family: Family;
	precision: string;
	/** From peaks.json via familyPeak; undefined for AMX. */
	peak: Peak | undefined;
	/** The family's fastest row at this device and precision, any size, or undefined. */
	best: Row | undefined;
}
export function engineRows(rows: Row[], peaks: Peak[], family: Map<string, Family>): EngineRow[];
```

- **One row per (device, family, float precision)** that has a peak or a measurement, ordered by `FAMILY_ORDER` then precision.
- **The peak** comes from `familyPeak`, so the table and the charts' dashed lines always agree:
  - serial → the 1-core `cpu` peak;
  - parallel → the widest `cpu` peak;
  - gpu → the `metal` peak;
  - amx → none.
- **The best measured row** is the highest `gops` among that family's rows at that device and precision, with a strict `>` for a stable tie-break.
- **Columns:** engine, precision, peak (GFLOP/s), best measured (GOP/s), the kernel, N and threads behind it, and % of peak. The % is computed like the charts' hover text (`pctOfPeak`'s rule, to 2 significant figures); AMX shows "—" with the note "no published peak".
- **Formatting:** numbers use the ladder's existing formatter, exported from `overview.ts` or moved to a shared module.
- **Sources:** a collapsible "Where the peaks come from" under the table lists each peak row's `source` text. Svelte interpolates it as text, so it is escaped.
- **E-cores:** the parallel row's best result is often a 10-thread run, which also uses the 2 E-cores the 8 P-core peak doesn't count. The threads column shows it, and a sentence in `hardware.md` explains it.

### About page

It has three blocks:
1. `about.md`: the MVP intro.
2. **Hardware tested**: `hardware.md`, then the table.
3. **Kernels**: the four families.

The "Views" section and the MVP intro string in `About.svelte` go.

## Testing

- **`markdown.test.ts`:**
  - paragraphs, lists, code blocks, links and a GFM table render;
  - `headingOffset` 2 turns `##` into `<h4>`;
  - the offset caps at `h6`.
- **`charts/index.test.ts`:**
  - replaces the MVP's `about` test: every panel's `doc` is non-empty, and no two panels share one;
  - the number of `.md` files in `web/src/docs/charts/` equals the number of panels, so there are no orphans (read with `node:fs`, like `docs.test.ts` reads `kernel.rs`);
  - every caption is at most 120 characters, a proxy for one line;
  - the existing `"about"` id check stays.
- **`docs.test.ts`:**
  - the "## `<kernel>`" headings across the four family files equal the `serial("…")` labels in `kernel.rs`;
  - no kernel is documented twice;
  - families follow `FAMILY_ORDER`;
  - every section has a `**Runs via:**` line.
- **`hardware.test.ts`:**
  - serial takes the 1-core peak and the best serial row;
  - parallel takes the widest peak and may report a 10-thread best;
  - AMX has no peak but has a best;
  - a device without peaks still gets measured rows;
  - integer precisions are excluded;
  - ties keep the first row.
- **Browser (Playwright, 1280 and 390 wide):**
  - every chart's toggle opens and shows rendered Markdown;
  - the About hardware table's numbers match a DuckDB query over `web/public/results.json` and `peaks.json`;
  - no console errors besides the container's Google Fonts certificate.

## Docs

- **`README.md`, Web Dashboard paragraph:**
  - docs are Markdown in `web/src/docs/`, rendered with `marked`;
  - each chart has a "How to read this chart" toggle;
  - About covers the tested hardware and the kernels.
- **`CLAUDE.md`, Gotchas:** dashboard docs are first-party Markdown in `web/src/docs/`, imported with `?raw` and inserted unsanitized, so contributed strings never go through `renderMarkdown`. A new kernel needs a "## `<label>`" section in its family's file, or `docs.test.ts` fails.
- **`.claude/skills/add-kernel/SKILL.md`:** the docs step points at `web/src/docs/kernels/<family>.md` instead of `KERNEL_DOCS`.
- **`.claude/agents/dashboard-designer.md`:** one line on `web/src/docs/` and `renderMarkdown`.

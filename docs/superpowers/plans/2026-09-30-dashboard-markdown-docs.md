# Dashboard Docs in Markdown Implementation Plan

> **For agentic workers:** Implement one task at a time, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends in one commit.

**Goal:**
- Move the dashboard's documentation into Markdown files.
- Show each chart's explanation under its own title, as a collapsible "How to read this chart", and trim the captions to one line.
- Turn the About page into the kernel reference, with more detail, plus a "Hardware tested" entry for the M1 Pro: its specs, and peak vs best measured for each engine.

**Architecture:**
- **Markdown:** lives in `web/src/docs/`, imported as strings with `?raw` (Vite and Bun both support it), and rendered by `renderMarkdown` in `web/src/lib/markdown.ts` (`marked`), inserted with `{@html}`.
- **Chart docs:** each chart panel's doc is a required field on `Panel`.
- **Kernel docs:** four family files, tied to `benchmark/src/kernel.rs` by a test.
- **Hardware table:** computed by a pure, tested function (`engineRows` in `web/src/lib/hardware.ts`) from `peaks.json` and the runs.

**Tech Stack:** Bun + Vite + Svelte 5 + TypeScript + Plotly.js 4.1.1 (`web/`), `marked` (new), Biome, `just`, lefthook.

**Spec:** `docs/superpowers/specs/2026-09-30-dashboard-markdown-docs-design.md`. Read it before starting any task: it holds the decisions, the file layout, the caption table, the kernel template, and the hardware table's rules.

## Global Constraints

- Run commands from the repo root through `just`: `just check && just test` before every commit, and `just data` before any browser check. `just lint` auto-fixes Biome formatting (tabs, double quotes).
- Lefthook runs fmt/clippy/test/Biome/typecheck/data-build on commit. Never pass `--no-verify`.
- End every commit message with these two lines, after a blank line:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EAjoE5HkUAJNGUDSDogaVG
  ```
- Work on `claude/gracious-einstein-ywu39k`. Commit per task; push after Task 6.
- **Markdown is first-party only.** Contributed strings (kernel, precision and device names from CSVs, and the peaks' `source` text) render through Svelte text interpolation, never `renderMarkdown` or `{@html}`.
- **No numbers from the data in Markdown.** Anything measured is computed and rendered by Svelte, because the data changes.
- **Every hardware figure cites a source,** as `peaks.csv` does. A figure you can't source is left out, never written from memory.
- **Colours:** only the existing inks (`FAMILY_INK`, `LABEL_INK`, the panel greys). Never add a hue.
- **Match the surrounding code:** comment density and voice (comments say *why*), naming, a strict `>` for stable tie-breaks. Touch only what the task needs.

## File Map

| File | Change |
| :--- | :--- |
| `web/package.json`, `web/bun.lock` | Add `marked` |
| `web/src/lib/markdown.ts`, `markdown.test.ts` | New: `renderMarkdown(src, headingOffset)` |
| `web/src/docs/charts/*.md` | New: 13 chart explanations |
| `web/src/lib/charts/index.ts`, `index.test.ts` | `Panel.doc`; trimmed notes; `Tab.about` removed |
| `web/src/lib/Chart.svelte` | "How to read this chart" toggle |
| `web/src/App.svelte` | Pass `doc` to `Chart` |
| `web/src/docs/kernels/{serial,parallel,amx,gpu}.md` | New: detailed kernel sections |
| `web/src/lib/docs.ts`, `docs.test.ts` | Family imports replace the TS catalogue; drift test reads Markdown headings |
| `web/src/docs/about.md`, `web/src/docs/hardware.md` | New: About intro; machine specs with sources |
| `web/src/lib/hardware.ts`, `hardware.test.ts` | New: `engineRows` |
| `web/src/lib/HardwareTable.svelte` | New: peak vs best measured table and its sources |
| `web/src/lib/charts/overview.ts` | Export `fmtGops` for the table |
| `web/src/lib/About.svelte` | Intro, Hardware tested, Kernels; Views section removed |
| `README.md`, `CLAUDE.md`, `.claude/skills/add-kernel/SKILL.md`, `.claude/agents/dashboard-designer.md` | Docs |

---

### Task 1: Markdown pipeline

**Files:**
- Modify: `web/package.json`, `web/bun.lock`
- Create: `web/src/lib/markdown.ts`, `web/src/lib/markdown.test.ts`

**Produces:** `renderMarkdown(src: string, headingOffset = 0): string`, as specified in the spec, with the "never pass a contributed string" doc comment. It keeps one `Marked` instance per offset, created on first use. Its `walkTokens` sets `token.depth = Math.min(6, token.depth + offset)` on headings.

- [ ] **Step 1:** `cd web && bun add marked`. Commit the lockfile change with the task; CI installs with `--frozen-lockfile`.
- [ ] **Step 2: Write the failing tests** in `markdown.test.ts`:
  - a paragraph with `**bold**` and a link;
  - a bullet list;
  - a fenced code block, whose contents are escaped (`<` becomes `&lt;`);
  - a GFM table renders `<table>`;
  - `renderMarkdown("## x", 2)` contains `<h4`;
  - `renderMarkdown("#### x", 5)` contains `<h6`;
  - offset 0 leaves `##` as `<h2`.
- [ ] **Step 3:** `bun test src/lib/markdown.test.ts`. Expected: fails, module missing.
- [ ] **Step 4: Implement.** Then `just check && just test`: all green.
- [ ] **Step 5: Commit** "Render the dashboard's Markdown docs with marked".

---

### Task 2: Per-chart explanations and one-line captions

**Files:**
- Create: `web/src/docs/charts/<panel>.md` × 13 (names in the spec)
- Modify: `web/src/lib/charts/index.ts`, `web/src/lib/charts/index.test.ts`, `web/src/lib/Chart.svelte`, `web/src/App.svelte`, `web/src/lib/About.svelte`

**Consumes:** `renderMarkdown` from Task 1.

**Produces:**
- **`Panel.doc: string`**, required, filled by one `?raw` import per chart at the top of `index.ts`.
- **`Tab.about` removed,** along with the six tab paragraphs.
- **Every `note` replaced** by its caption from the spec's table. Tighten the wording, but keep each caption to what's needed to read the axes, at most 120 characters.
- **`Chart.svelte`:**
  - a `doc: string` prop, required;
  - `const html = $derived(renderMarkdown(doc))`;
  - under `<header>`, `<details class="doc"><summary>How to read this chart</summary><div class="prose">{@html html}</div></details>`, rendered for both the chart and the empty state;
  - styles: summary in `#9aa1a8` at 13px with a pointer cursor; prose at 14px, line-height 1.6, max-width 72ch; `code` in IBM Plex Mono.
- **`App.svelte`:** `<Chart … doc={panel.doc} />`.
- **`About.svelte`:** the Views section is removed (Task 4 rebuilds the page; this only drops what no longer exists).

- [ ] **Step 1: Write the failing tests** in `index.test.ts`, replacing the MVP's `about` test:
  - every panel's `doc` is non-empty, and no two panels share one;
  - `readdirSync(new URL("../../docs/charts/", import.meta.url))` holds exactly as many `.md` files as there are panels;
  - every `note` is at most 120 characters;
  - keep the check that no tab's id is `"about"`.
- [ ] **Step 2:** `bun test src/lib/charts/index.test.ts`. Expected: fails.
- [ ] **Step 3: Write the 13 Markdown files** in the spec's shape: **What it shows.** / **How to read it.** / **Caveats.**, no headings, no numbers from the data. Sources:
  - the MVP tab paragraphs (`git show 33380e2:web/src/lib/charts/index.ts`), split across that tab's charts;
  - the current notes;
  - the chart function's doc comment in `charts/*.ts`.
- [ ] **Step 4: Nothing-lost check.** For each old note (`git show 33380e2:web/src/lib/charts/index.ts`), confirm that every clause not in the new caption is in the chart's Markdown. List any you drop deliberately in the commit message.
- [ ] **Step 5: Implement** the Produces list. Then `just check && just test`.
- [ ] **Step 6: Browser check.** `just data`, then `just dev`. On every tab:
  - each chart has a closed toggle, and opening it shows formatted text;
  - the captions are one line at 1280 wide;
  - zoom and legend state still survive a picker change (the toggle mustn't remount the plot).
- [ ] **Step 7: Commit** "Explain each chart under its title, from Markdown".

---

### Task 3: Kernel docs in Markdown, in more detail

**Files:**
- Create: `web/src/docs/kernels/serial.md`, `parallel.md`, `amx.md`, `gpu.md`
- Modify: `web/src/lib/docs.ts`, `web/src/lib/docs.test.ts`, `web/src/lib/About.svelte`

**Produces:**
- **Four family files.** Each opens with the MVP's family blurb, then one "## `<kernel>`" section per kernel, in the MVP's order, following the spec's per-kernel template:
  - summary;
  - a pseudo-code sketch of at most about 8 lines;
  - **Runs via**, **Tunes**, **Precisions**, **Watch for** (where it applies), and **Source** (a GitHub link to the kernel's file on `main`).
  - Take the precisions from `KernelInfo` in `benchmark/src/kernel.rs` and the caveats from the spec's list and the README's kernel tables.
- **`docs.ts`:** `FamilyDoc { family, title, doc }` and `KERNEL_DOCS` in `FAMILY_ORDER`. The titles are the MVP's. `KernelDoc` is removed.
- **`About.svelte`:** per family, the MVP's heading (dot, legend name, title), then `{@html renderMarkdown(g.doc, 2)}` in a `.prose` block. The `<dl>` markup and its styles go.

- [ ] **Step 1: Rewrite `docs.test.ts`** to read the kernel names from `KERNEL_DOCS[*].doc` with `/^## `?([^`\s]+)`?\s*$/gm`. Keep the checks:
  - the names equal the `serial("…")` labels in `kernel.rs`;
  - no kernel appears twice;
  - families follow `FAMILY_ORDER`.
  Add one: every "## " section contains `**Runs via:**`. Run it and see it fail.
- [ ] **Step 2: Write the four files; implement `docs.ts` and `About.svelte`.** Check every sketch against its kernel's source, especially the loop order, the partitioning, and `rayon-tiled`'s chunk count.
- [ ] **Step 3:** `just check && just test`. Then rename one heading in `gpu.md` and confirm `docs.test.ts` fails naming it, then restore it.
- [ ] **Step 4: Browser check:** the About page's kernel sections render, with `h4` kernel headings, code blocks in IBM Plex Mono, and working links.
- [ ] **Step 5: Commit** "Document each kernel in Markdown, with sketches and caveats".

---

### Task 4: Hardware tested

**Files:**
- Create: `web/src/lib/hardware.ts`, `web/src/lib/hardware.test.ts`, `web/src/lib/HardwareTable.svelte`, `web/src/docs/hardware.md`, `web/src/docs/about.md`
- Modify: `web/src/lib/charts/overview.ts` (export `fmtGops`), `web/src/lib/About.svelte`, `web/src/App.svelte` (pass `store.rows`, `store.peaks` and `ctx.family` to `About`)

**Produces:**
- **`engineRows(rows, peaks, family): EngineRow[]`**, as in the spec. It covers float precisions only, in `FAMILY_ORDER` then precision order, with one row per (device, family, precision) that has a peak or a measurement.
  - The peak comes from `familyPeak`.
  - The best row is the family's highest `gops` at that device and precision, with a strict `>`.
  - `engine` labels: serial → `1 P-core`; parallel → `${cores} P-cores` from its peak, or `CPU (all threads)` without one; amx → `AMX`; gpu → `GPU (${cores} cores)` from its peak, or `GPU`.
- **`HardwareTable.svelte`:**
  - columns: engine, precision, peak (GFLOP/s), best measured (GOP/s), "kernel · N = n · t threads", and % of peak (2 significant figures, the `pctOfPeak` rule);
  - AMX shows "—" in both peak and %, with "no published peak" as the peak cell's text;
  - under the table, `<details>` "Where the peaks come from" lists each distinct peak's device, backend, precision, cores and `source` as text;
  - one table per device if there is more than one.
- **`hardware.md`:** a short paragraph and the spec table.
  - Machine: MacBook Pro 16-inch (2021), M1 Pro, 16 GB.
  - Check every figure against the source you cite. Four are already cited in `peaks.csv` (the clocks, the FMA pipes, the GPU ALUs and clock). Verify the rest before writing them: caches, AMX, memory bandwidth.
  - End with the E-core sentence: the parallel row's best may be a 10-thread run, which the 8 P-core peak doesn't count.
- **`about.md`:** the MVP intro paragraph.
- **`About.svelte`:** `about.md`, then `<h2>Hardware tested</h2>`, `hardware.md` (offset 2) and `<HardwareTable>`, then `<h2>Kernels</h2>` as in Task 3.

- [ ] **Step 1: Write the failing tests** in `hardware.test.ts`, using `row()` and `peak()` from `fixtures.ts`:
  - serial pairs the 1-core peak with the best serial row;
  - parallel pairs the widest peak with a 10-thread best;
  - AMX has `peak: undefined` and a best;
  - a GPU at `f64` with no rows and no peak → no row;
  - a device with no peaks still gets its measured rows;
  - `i32` rows are excluded;
  - a tie keeps the first row;
  - the rows are ordered by family, then precision.
- [ ] **Step 2:** `bun test src/lib/hardware.test.ts`. Expected: fails.
- [ ] **Step 3: Implement** `hardware.ts`, the `fmtGops` export and `HardwareTable.svelte`. Write `hardware.md` and `about.md`, and wire `About.svelte`.
- [ ] **Step 4:** `just check && just test`.
- [ ] **Step 5: Numbers check.** `just data`, then check the table's best-measured and % cells against DuckDB. For example:
  ```sh
  duckdb -c "SELECT backend, precision, max(gops) FROM 'web/public/results.json' WHERE backend = 'amx' AND precision IN ('f16','f32','f64') GROUP BY ALL"
  ```
  Also check the serial (CPU, `threads = 1`, non-parallel kernels), parallel and GPU rows.
- [ ] **Step 6: Commit** "Add a Hardware tested entry: M1 Pro specs, peak vs best measured".

---

### Task 5: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.claude/skills/add-kernel/SKILL.md`, `.claude/agents/dashboard-designer.md`

- [ ] **Step 1: `README.md`, Web Dashboard paragraph.** Replace the MVP's About sentences:
  - docs are Markdown in `web/src/docs/`, rendered with `marked`;
  - each chart has a "How to read this chart" toggle;
  - About covers the tested hardware (specs, and peak vs best measured per engine) and the kernels;
  - `docs.test.ts` ties the kernel sections to `kernel.rs`.
- [ ] **Step 2: `CLAUDE.md`, Gotchas.** Add one bullet:
  - the docs are first-party Markdown in `web/src/docs/`, imported with `?raw` and inserted unsanitized, so contributed strings never go through `renderMarkdown`;
  - a new kernel needs a "## `<label>`" section in its family's file;
  - a new chart panel needs a `docs/charts/*.md` file.
- [ ] **Step 3: `add-kernel/SKILL.md`, docs step.** Point it at `web/src/docs/kernels/<family>.md` and the section template.
- [ ] **Step 4: `dashboard-designer.md`.** Add one line: chart explanations and kernel docs live in `web/src/docs/`, and every `Panel` needs a `doc`.
- [ ] **Step 5: Commit** "Document the Markdown docs".

---

### Task 6: End-to-end verification

- [ ] `just check && just test && just data`.
- [ ] `cd web && bun run build && bun run preview`. With Playwright at 1280 and 390 wide:
  - open every chart's toggle on every tab and screenshot it;
  - screenshot the whole About page;
  - check there are no console errors besides the container's Google Fonts certificate;
  - check the phone-width page is no wider than before this work (614px; the tab row is a separate task).
- [ ] Re-read every Markdown file once more against the code it describes: an explanation that's wrong is worse than none.
- [ ] `/code-review` at high effort over `33380e2..HEAD`, and fix what it confirms.
- [ ] Push `claude/gracious-einstein-ywu39k`.

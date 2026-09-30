# Dashboard About Tab: What Each View Compares, What Each Kernel Does

- **Status:** MVP implemented (2026-09-30), with the draft copy below as written; the copy may be revised later.
- **Branch:** `claude/gracious-einstein-ywu39k`
- **Builds on:** PR #22 (`feat/dashboard-hpc-metrics`), merged into `main` as `33b705c`.

## Problem

The dashboard never says what its kernels are. A reader sees `static-tiled` or `accelerate-bnns` in a legend with no way to learn what it does or what hardware it runs on, short of opening the README. Each tab's charts carry a one-line caption, but nothing says what a tab as a whole compares. Some captions have grown to a paragraph to compensate: the Block size note, and the accuracy scatter's.

## Decisions

| Question | Decision |
| :--- | :--- |
| Audience | Portfolio / public, as in the HPC-metrics spec: plain language, and each HPC term defined where it first appears. |
| "Each benchmarking method" | What each tab compares and how to read its charts. How a measurement is taken (warm-up, repetitions, the correctness check, the accuracy definition) stays in the README. |
| "How each kernel is accessed" | How the kernel reaches the hardware: plain Rust loops, a Rayon pool, a C call into Accelerate, the Swift shim, Metal. Not the `--kernel` flag that runs it. |
| Placement | A seventh tab, **About**, last in the tab row. |
| Where the text lives | TypeScript: an `about` field on each chart tab, and a kernel catalogue in `web/src/lib/docs.ts`. No Markdown parser, no generation from Rust (five of the twelve kernels are macOS-only and CI and deploy run on Linux, so a generator there would leave them out). |

## Goals

1. An **About** tab: a two-sentence intro, then **Views** (one entry per chart tab), then **Kernels** (one entry per kernel, grouped by family).
2. Each view entry says what the tab compares and how to read its charts, in two to four sentences.
3. Each kernel entry says what the kernel does and how it reaches the hardware, in one to three sentences each.
4. A test fails when a kernel is added to or removed from `benchmark/src/kernel.rs` without its catalogue entry changing too.

## Non-Goals

- Measurement methodology, CLI flags, and the CSV schema. The README keeps them.
- Contextual help on the chart tabs: "About this view" boxes, legend tooltips, links from a panel to its About entry. The same goes for shortening the long panel notes now that the About tab exists.
- Showing About when `results.json` fails to load or is empty. It lives inside the loaded state, like the chart tabs, so `App.svelte`'s loading and error branches stay as they are.
- Deep links to a section (the dashboard has no URL state).
- Data-derived facts in the kernel entries (precisions measured, devices). The entries are static text.
- The tab row on phones. It doesn't wrap, so a seventh tab makes it wider still on narrow screens. This problem predates the About tab and gets its own change.

## Design

### Placement: `web/src/App.svelte`

- The About button follows the chart tabs in `<nav>` and sets `store.tab = "about"` through the existing `selectTab`.
- About is not an entry in `TABS`. `visibleTabs` hides any tab whose charts can't be built, and every `TABS` entry gets the controls bar and the Relative toggle; About has neither. So `App.svelte` branches on it: `{#if store.tab === "about"} <About /> {:else}` controls, panels and data view `{/if}`.
- While About is open, `tab` falls back to `tabs[0]` as it already does for an unknown id. The chart tabs' `class:current` gains `store.tab !== "about" &&`, so Overview isn't highlighted beside About.

### View text: an `about` field on `Tab`

`Tab` in `web/src/lib/charts/index.ts` gains a required `about: string`. Each tab's text sits next to its panels, and a new tab without text fails the typecheck. About renders every `TABS` entry, not only the visible ones: the text is static and doesn't depend on the data.

### Kernel text: `web/src/lib/docs.ts`

```ts
export interface KernelDoc {
	/** The CSV `kernel` label, as the charts show it. */
	name: string;
	/** What it does, in plain language. */
	what: string;
	/** How it reaches the hardware. */
	via: string;
}

export interface FamilyDoc {
	family: Family;
	/** The heading beside the family's legend name. */
	title: string;
	/** One line: what the family's kernels share. */
	blurb: string;
	kernels: KernelDoc[];
}

/** In FAMILY_ORDER, kernels in the order the README lists them. */
export const KERNEL_DOCS: FamilyDoc[] = [/* … */];
```

The family is written into each group rather than read from the data with `families()`, so the catalogue renders the same whatever the data holds.

### Layout: `web/src/lib/About.svelte`

- One column of prose, capped at about 72 characters wide.
- Styled with the existing panel colours (`#15181b` background, `#24292e` border, `#9aa1a8` secondary text).
- Kernel names are in IBM Plex Mono, like the pickers.
- Each family heading shows the family's legend name (`serial`, `parallel`, `amx`, `gpu`) with a dot in its `FAMILY_INK`, so a reader can match it to the chart colours.
- Kernels are a `<dl>`: the name as `<dt>`, and the "what" and "Runs via" lines as `<dd>`s.

## Draft Copy

### Intro

> gemm-bench times one operation, C = A × B on square N × N matrices, implemented many ways: from textbook loops on one CPU core up to Apple's AMX coprocessor and GPU. Throughput is in GOP/s: billions of operations per second, counting N³ multiplies and N³ adds against the median of several timed runs. Higher is better.

### Views

**Overview.** The headline: how fast each kind of kernel gets. The optimization ladder starts at `naive-ijk` and shows what each technique buys over the one before it: better single-core code, then threads, then AMX, then the GPU. Every rung is read at the largest size they all ran. Throughput by family plots each family's best result at every size, with dashed lines at the hardware's theoretical peak. Fastest kernel per size names the winner at each size.

**CPU & AMX.** Every CPU and AMX kernel as the matrices grow, each at its best thread count and the selected block size. The gaps between lines show what loop order, cache blocking, threads and AMX each add. Relative re-plots every line as a speedup over `naive-ijk`. The second chart shows only the single-threaded kernels, on a scale where their differences are visible.

**CPU threading.** How the multi-threaded CPU kernels scale as threads are added, at one matrix size. The `rayon-*` kernels balance work by letting idle threads take it from busy ones; the `static-*` kernels split it evenly up front. Relative re-plots each line as a speedup over one thread. Parallel efficiency divides that speedup by the thread count for the selected kernel at every size: 100% means every added thread paid for itself in full.

**Precision.** Each family's best result at every element type, at one matrix size: 16-, 32- and 64-bit floats (`f16`, `f32`, `f64`) and 32- and 64-bit integers (`i32`, `i64`). Narrower types fit more values into each SIMD register, so they can run faster. Accuracy vs throughput plots each float kernel's error against its speed: up and to the left is faster and more accurate.

**GPU.** Each GPU kernel against the best threaded-CPU and AMX results. GPU times include copying the matrices into and out of the GPU's buffers, so they compare like for like with the CPU times. GPU ÷ CPU at equal effort pairs hand-written code with hand-written code (the shaders against the threaded CPU kernels) and vendor library with vendor library (MPS against Accelerate); above 1.0 the GPU wins. Copy overhead shows how much of each GPU run goes to copying data in and out and preparing the GPU's work rather than computing; that share shrinks as N grows.

**Block size.** How the tile size changes the throughput of the tiled kernels at one matrix size. Smaller tiles fit in faster caches; larger ones spend less time on loop bookkeeping. Small differences between points are run-to-run noise.

### Kernels

**`serial`: single-threaded CPU.** One core. These kernels show what the order of memory accesses is worth on its own.

| Kernel | What | Runs via |
| :--- | :--- | :--- |
| `naive-ijk` | The textbook triple loop: each output value is a row of A times a column of B. Walking down a column of B jumps a whole row ahead in memory at every step, so most reads miss the cache. It's the baseline the optimization ladder and the CPU & AMX speedups start from. | Plain Rust loops on one core. |
| `ikj` | The same arithmetic with the two inner loops swapped. The innermost loop now walks along rows of B and C, which sit next to each other in memory, so reads come from cache and the compiler can process several values per instruction (SIMD). | Plain Rust on one core, vectorized by the compiler (NEON on Apple Silicon). |
| `tiled` | `ikj`, working through the matrices in square tiles (the block size), so the parts of A, B and C in use stay in the L1/L2 cache while they're reused. | Plain Rust on one core, at each block size measured. |

**`parallel`: multi-threaded CPU.** The same loops spread over several cores. They differ in how they hand out the work.

| Kernel | What | Runs via |
| :--- | :--- | :--- |
| `rayon-ikj` | `ikj` with the output rows shared out by Rayon. Threads that finish early take rows from busy ones (work stealing), so fast and slow cores both stay busy. | A Rayon parallel iterator, on a thread pool of the measured size. |
| `rayon-tiled` | Rows grouped into chunks, about four chunks per thread, each computed in tiles like `tiled`. Work stealing balances the chunks across threads. | A Rayon parallel iterator over the row chunks. |
| `static-ikj` | Rows split into equal consecutive ranges up front, one per thread, like OpenMP's static schedule. Nothing is rebalanced, so there's no scheduling overhead, but the run lasts as long as its slowest thread. | A persistent Rayon thread pool used without stealing: one broadcast hands every thread its fixed range. |
| `static-tiled` | The same fixed split, computed in tiles inside each thread's range. | The same pool and broadcast as `static-ikj`. |

**`amx`: Apple's matrix coprocessor.** A matrix unit beside the CPU cores. Apple doesn't document its instructions, so the only way to use it is through Apple's Accelerate library.

| Kernel | What | Runs via |
| :--- | :--- | :--- |
| `accelerate-blas` | Apple's BLAS matrix multiply (`sgemm` for `f32`, `dgemm` for `f64`), which runs on AMX on Apple Silicon. Accelerate picks its own threading. | A C function call from Rust into Apple's Accelerate framework. |
| `accelerate-bnns` | The same AMX through BNNSGraph, Apple's machine-learning graph API: a one-operation graph, compiled once per matrix size before timing starts. At `f16` it also adds up in `f16`, so it's fast but loses accuracy as N grows. | Rust calls a small Swift package, because the BNNSGraph builder is Swift-only (macOS 26+). The package calls Accelerate. |

**`gpu`: Apple GPU (Metal).** The CPU and GPU share memory, but each run still copies the inputs into GPU buffers and the result back out, and that copying is timed.

| Kernel | What | Runs via |
| :--- | :--- | :--- |
| `mps` | Apple's tuned GPU matrix multiply, `MPSMatrixMultiplication` from Metal Performance Shaders. | Metal's Objective-C API, called from Rust through the `objc2` bindings. |
| `metal-naive` | A hand-written GPU program (a compute shader) that runs one GPU thread per output value. Each thread reads its row of A and column of B straight from GPU memory. | `gemm.metal`, compiled from source at run time and dispatched through Metal. |
| `metal-tiled` | The same shader file, tiled: each 16 × 16 group of GPU threads loads a tile of A and one of B into fast on-chip memory and shares them. Each value is then fetched from GPU memory once per group instead of once per thread. | The same as `metal-naive`. |

## Testing

- **`web/src/lib/docs.test.ts`**
  - The kernel names in `KERNEL_DOCS` equal, as a set, the `serial("…")` labels in `benchmark/src/kernel.rs`, read with `Bun.file` from the test's own URL. The failure message names the missing or extra kernel. This keeps the catalogue tied to the kernel registry: every `KernelInfo` row passes through `serial("<label>")`.
  - No kernel appears twice, and every `what` and `via` is non-empty.
  - The groups follow `FAMILY_ORDER`, one group per family.
- **`web/src/lib/charts/index.test.ts`:** every `TABS` entry has a non-empty `about`.
- **Before pushing:** `just check && just test`.
- **In the browser (`just dev`):**
  - About renders.
  - Only the About button is highlighted while it's open.
  - The controls, Relative toggle and data view are hidden on About.
  - Switching back to a chart tab restores the charts as before.

## Docs

- **`README.md`, Web Dashboard section:** "in six tabs" becomes six chart tabs plus an About tab that explains each view and kernel.
- **`.claude/skills/add-kernel/SKILL.md`:** alongside its README step, add an entry to `KERNEL_DOCS` in `web/src/lib/docs.ts`. `docs.test.ts` fails without it.

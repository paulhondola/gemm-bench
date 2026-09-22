<script lang="ts">
import Chart from "./lib/Chart.svelte";
import { rowsForTab, visibleTabs } from "./lib/charts/index";
import { makeCtx } from "./lib/charts/types";
import {
	allSizes,
	blockSizes,
	blockSizesFor,
	defaultBlockSizeFor,
	defaultParallelKernel,
	defaultSize,
	families,
	kernels,
	sizesFor,
} from "./lib/derive";
import { boot, store } from "./lib/state.svelte";

boot();

const ctx = $derived(makeCtx(store.rows));
const filters = $derived({
	precision: store.precision,
	n: store.n,
	kernel: store.kernel,
	blockSize: store.blockSize,
	relative: store.relative,
});
const tabs = $derived(visibleTabs(store.rows, filters, ctx));
const tab = $derived(tabs.find((t) => t.id === store.tab) ?? tabs[0]);
const scoped = $derived(
	tab ? rowsForTab(tab, store.rows, store.precision, store.blockSize, ctx) : [],
);
const available = $derived(sizesFor(store.rows, store.precision));
const availableBlockSizes = $derived(
	blockSizesFor(store.rows, store.precision, store.n),
);
// The kernel pill group is threading-tab-only and must offer only the
// kernels that tab's chart can plot — parallel-family kernels — not every
// kernel in scope.
const parallelKernelList = $derived(
	kernels(scoped).filter((k) => ctx.family.get(k) === "parallel"),
);

function pickPrecision(p: string) {
	store.precision = p;
	if (!sizesFor(store.rows, p).includes(store.n)) {
		store.n = defaultSize(store.rows, p);
	}
	if (!blockSizesFor(store.rows, p, store.n).includes(store.blockSize)) {
		store.blockSize = defaultBlockSizeFor(store.rows, p, store.n);
	}
	const family = families(store.rows);
	const kernelStillValid = store.rows.some(
		(r) =>
			r.precision === p &&
			r.kernel === store.kernel &&
			family.get(String(r.kernel)) === "parallel",
	);
	if (!kernelStillValid) {
		store.kernel = defaultParallelKernel(store.rows, p);
	}
}

function pickSize(s: number) {
	store.n = s;
	if (
		!blockSizesFor(store.rows, store.precision, s).includes(store.blockSize)
	) {
		store.blockSize = defaultBlockSizeFor(store.rows, store.precision, s);
	}
}

function pickBlockSize(b: number) {
	store.blockSize = b;
}

function selectTab(id: string) {
	store.tab = id;
	// Projection state is per-chart, not persisted across tab switches.
	store.relative = false;
}
</script>

<main>
	<header>
		<h1>gemm-bench</h1>
		<p>C = A·B on square N×N matrices · throughput = 2N³ / median wall time</p>
		{#if store.dropped > 0}
			<p>
				{store.dropped} row{store.dropped === 1 ? "" : "s"} discarded as unusable
				(non-finite or non-positive values)
			</p>
		{/if}
	</header>

	{#if store.error}
		<p class="error">{store.error}</p>
	{:else if !store.loaded}
		<p class="muted">Loading DuckDB…</p>
	{:else if !tab}
		<p class="muted">No results yet. Run <code>just bench</code> and <code>just data</code>.</p>
	{:else}
		<nav>
			{#each tabs as t}
				<button
					type="button"
					class:current={t.id === tab.id}
					onclick={() => selectTab(t.id)}>{t.label}</button>
			{/each}
		</nav>

		<div class="controls">
			{#if tab.controls.includes("precision") || tab.inertPrecision}
				<div class="group" role="group" aria-label="Precision">
					{#each [...new Set(store.rows.map((r) => String(r.precision)))].sort() as p}
						<button
							type="button"
							disabled={tab.inertPrecision}
							title={tab.inertPrecision ? "Precision is this chart's x-axis" : ""}
							aria-pressed={p === store.precision}
							class:on={p === store.precision}
							onclick={() => pickPrecision(p)}>{p}</button>
					{/each}
				</div>
			{/if}

			{#if tab.controls.includes("n")}
				<div class="group" role="group" aria-label="Matrix size">
					{#each allSizes(store.rows) as s}
						<button
							type="button"
							disabled={!available.includes(s)}
							title={available.includes(s)
								? ""
								: `no ${store.precision} runs at N = ${s}`}
							aria-pressed={s === store.n}
							class:on={s === store.n}
							onclick={() => pickSize(s)}>N = {s}</button>
					{/each}
				</div>
			{/if}

			{#if tab.controls.includes("blockSize")}
				<div class="group" role="group" aria-label="Block size">
					{#each blockSizes(store.rows) as b}
						<button
							type="button"
							disabled={!availableBlockSizes.includes(b)}
							title={availableBlockSizes.includes(b)
								? ""
								: `no ${store.precision} b = ${b} runs at N = ${store.n}`}
							aria-pressed={b === store.blockSize}
							class:on={b === store.blockSize}
							onclick={() => pickBlockSize(b)}>b = {b}</button>
					{/each}
				</div>
			{/if}

			{#if tab.controls.includes("kernel")}
				<div class="group" role="group" aria-label="Kernel">
					{#each parallelKernelList as k}
						<button
							type="button"
							aria-pressed={k === store.kernel}
							class:on={k === store.kernel}
							onclick={() => (store.kernel = k)}>{k}</button>
					{/each}
				</div>
			{/if}

			<label class="toggle">
				<input type="checkbox" bind:checked={store.relative} />
				Relative
			</label>
		</div>

		<div class="panels">
			{#each tab.panels as panel}
				<Chart
					title={panel.title}
					note={panel.note}
					spec={panel.spec(scoped, filters, ctx)} />
			{/each}
		</div>

		<details class="table">
			<summary>Data view ({scoped.length} rows)</summary>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							{#each scoped.length ? Object.keys(scoped[0]) : [] as c}<th>{c}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each scoped as row}
							<tr>
								{#each Object.keys(scoped[0]) as c}
									<td>
										{typeof row[c] === "number" && !Number.isInteger(row[c])
											? (row[c] as number).toFixed(3)
											: row[c]}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</main>

<style>
	main {
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	h1 {
		margin: 0;
		font-family: "IBM Plex Mono", monospace;
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.5px;
	}
	header p,
	.muted {
		margin: 6px 0 0;
		font-size: 14px;
		color: #9aa1a8;
	}
	.error {
		color: #e66767;
	}
	nav {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid #24292e;
	}
	nav button {
		min-height: 44px;
		padding: 0 18px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		font-size: 14px;
		font-weight: 500;
		color: #9aa1a8;
		cursor: pointer;
	}
	nav button.current {
		color: #e6e3dc;
		border-bottom-color: #e8743b;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
	}
	.group {
		display: flex;
		gap: 6px;
		padding: 3px;
		background: #15181b;
		border: 1px solid #24292e;
		border-radius: 8px;
	}
	.group button {
		min-height: 36px;
		padding: 0 14px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #9aa1a8;
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
		cursor: pointer;
	}
	.group button.on {
		background: #e6e3dc;
		color: #0e1012;
	}
	.group button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.toggle {
		font-size: 13px;
		color: #9aa1a8;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.panels {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.table summary {
		cursor: pointer;
		color: #9aa1a8;
		font-size: 13px;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 12px;
	}
	table {
		border-collapse: collapse;
		font-family: "IBM Plex Mono", monospace;
		font-size: 12px;
	}
	th,
	td {
		padding: 6px 12px;
		text-align: right;
		border-bottom: 1px solid #24292e;
		white-space: nowrap;
	}
	th {
		color: #9aa1a8;
		font-weight: 500;
	}
</style>

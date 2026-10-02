<script lang="ts">
import About from "./lib/About.svelte";
import Chart from "./lib/Chart.svelte";
import { rowsForTab, visibleTabs } from "./lib/charts/index";
import { makeCtx } from "./lib/charts/types";
import type { Row } from "./lib/db";
import {
	allSizes,
	defaultParallelKernel,
	defaultSize,
	families,
	formatParams,
	kernels,
	knobLabel,
	knobNames,
	knobValues,
	knobValuesFor,
	pinKnobs,
	sizesFor,
} from "./lib/derive";
import PickerGroup from "./lib/PickerGroup.svelte";
import { boot, store } from "./lib/state.svelte";

boot();

const ctx = $derived(makeCtx(store.rows, store.peaks));
const filters = $derived({
	precision: store.precision,
	n: store.n,
	kernel: store.kernel,
	knobs: store.knobs,
	relative: store.relative,
});
const tabs = $derived(visibleTabs(store.rows, filters, ctx));
// Not a TABS entry: it has no panels to make it visible and no controls.
const about = $derived(store.tab === "about");
const tab = $derived(tabs.find((t) => t.id === store.tab) ?? tabs[0]);
const scoped = $derived(
	tab ? rowsForTab(tab, store.rows, store.precision, store.knobs, ctx) : [],
);
const columns = $derived(
	scoped.length ? (Object.keys(scoped[0]) as (keyof Row)[]) : [],
);
const available = $derived(sizesFor(store.rows, store.precision));
// The kernel pill group is threading-tab-only and must offer only the
// kernels that tab's chart can plot — parallel-family kernels — not every
// kernel in scope.
const parallelKernelList = $derived(
	kernels(scoped).filter((k) => ctx.family.get(k) === "parallel"),
);

/** One data-view cell: params as name=value pairs, floats to 3 places. */
function cell(value: Row[keyof Row]): string {
	if (value !== null && typeof value === "object") return formatParams(value);
	if (typeof value === "number" && !Number.isInteger(value))
		return value.toFixed(3);
	return String(value ?? "");
}

function pickPrecision(p: string) {
	store.precision = p;
	if (!sizesFor(store.rows, p).includes(store.n)) {
		store.n = defaultSize(store.rows, p);
	}
	store.knobs = pinKnobs(store.rows, p, store.n, store.knobs);
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
	store.knobs = pinKnobs(store.rows, store.precision, s, store.knobs);
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
		<p class="muted">Loading results…</p>
	{:else if !store.host}
		<p class="muted">
			No host databases yet. Run <code>just init &lt;github-login&gt;/&lt;machine&gt;</code> once,
			then <code>just bench</code>.
		</p>
	{:else if !tab}
		<p class="muted">{store.host.id} has no measurements to chart yet.</p>
	{:else}
		<nav>
			{#each tabs as t}
				<button
					type="button"
					class:current={!about && t.id === tab.id}
					onclick={() => selectTab(t.id)}>{t.label}</button>
			{/each}
			<button
				type="button"
				class:current={about}
				onclick={() => selectTab("about")}>About</button>
		</nav>

		{#if about}
			<About rows={store.rows} peaks={store.peaks} family={ctx.family} />
		{:else}
			<div class="controls">
				{#if tab.controls.includes("precision") || tab.inertPrecision}
					<PickerGroup
						label="Precision"
						items={[...new Set(store.rows.map((r) => String(r.precision)))].sort()}
						selected={store.precision}
						disabled={() => Boolean(tab.inertPrecision)}
						title={() =>
							tab.inertPrecision ? "Precision is this chart's x-axis" : ""}
						onSelect={pickPrecision} />
				{/if}

				{#if tab.controls.includes("n")}
					<PickerGroup
						label="Matrix size"
						items={allSizes(store.rows)}
						selected={store.n}
						format={(s) => `N = ${s}`}
						disabled={(s) => !available.includes(s)}
						title={(s) =>
							available.includes(s) ? "" : `no ${store.precision} runs at N = ${s}`}
						onSelect={pickSize} />
				{/if}

				{#if tab.controls.includes("knobs")}
					{#each knobNames(store.rows) as name (name)}
						{@const here = knobValuesFor(store.rows, name, store.precision, store.n)}
						<PickerGroup
							label={knobLabel(name)}
							items={knobValues(store.rows, name)}
							format={(v) => `${knobLabel(name).toLowerCase()} ${v}`}
							selected={store.knobs[name] ?? 0}
							disabled={(v) => !here.includes(v)}
							title={(v) =>
								here.includes(v)
									? ""
									: `no ${store.precision} ${knobLabel(name).toLowerCase()} ${v} runs at N = ${store.n}`}
							onSelect={(v) => (store.knobs = { ...store.knobs, [name]: v })} />
					{/each}
				{/if}

				{#if tab.controls.includes("kernel")}
					<PickerGroup
						label="Kernel"
						items={parallelKernelList}
						selected={store.kernel}
						onSelect={(k) => (store.kernel = k)} />
				{/if}

				<label class="toggle">
					<input type="checkbox" bind:checked={store.relative} />
					Relative
				</label>
			</div>

			<div class="panels">
				<!-- Keyed: one Chart per panel, so a panel never inherits another
				     tab's chart state. -->
				{#each tab.panels as panel (panel.title)}
					<Chart
						title={panel.title}
						note={panel.note}
						doc={panel.doc}
						spec={panel.spec(scoped, filters, ctx)} />
				{/each}
			</div>

			<details class="table">
				<summary>Data view ({scoped.length} rows)</summary>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								{#each columns as c}<th>{c}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each scoped as row}
								<tr>
									{#each columns as c}<td>{cell(row[c])}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{/if}
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

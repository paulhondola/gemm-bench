<script lang="ts">
import { rowsForTab } from "./lib/charts/scope";
import { makeCtx } from "./lib/charts/spec";
import { TABS } from "./lib/charts/tabs";
import About from "./lib/components/about/About.svelte";
import Chart from "./lib/components/Chart.svelte";
import Controls from "./lib/components/Controls.svelte";
import DataTable from "./lib/components/DataTable.svelte";
import HostPicker from "./lib/components/HostPicker.svelte";
import { precisionsForTab } from "./lib/state/filters";
import { boot, store } from "./lib/state/store.svelte";

boot();

const ctx = $derived(makeCtx(store.rows, store.peaks));
const filters = $derived({
	precision: store.precision,
	n: store.n,
	kernel: store.kernel,
	knobs: store.knobs,
	relative: store.relative,
});
// Not a TABS entry: it has no panels to make it visible and no controls.
const about = $derived(store.tab === "about");
const tab = $derived(TABS.find((t) => t.id === store.tab) ?? TABS[0]);
const scoped = $derived(
	rowsForTab(tab, store.rows, store.precision, store.knobs, ctx),
);
// Precision is the x-axis of an inertPrecision tab, so it always charts.
// Read without `relative`: the projection never decides whether a panel
// exists, so the toggle shouldn't rebuild every precision's panels.
const tabPrecisions = $derived(
	about || tab.inertPrecision
		? []
		: precisionsForTab(
				tab,
				store.rows,
				{
					precision: store.precision,
					n: store.n,
					kernel: store.kernel,
					knobs: store.knobs,
					relative: false,
				},
				ctx,
			),
);
const charted = $derived(
	Boolean(tab.inertPrecision) || tabPrecisions.includes(store.precision),
);

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
		{#if store.hosts.length > 0}<HostPicker />{/if}
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
	{:else if store.rows.length === 0}
		<p class="muted">{store.host.id} has no measurements to chart yet.</p>
	{:else}
		<nav>
			{#each TABS as t}
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
			<About
				rows={store.rows}
				peaks={store.peaks}
				family={ctx.family}
				machine={store.machine} />
		{:else}
			<Controls {tab} {tabPrecisions} {scoped} {filters} family={ctx.family} />

			{#if !charted}
				<p class="muted">
					{#if tabPrecisions.length > 0}
						No {tab.label} runs to chart at {store.precision}. Try {tabPrecisions.join(", ")}.
					{:else if scoped.length > 0}
						{store.host.id}'s {tab.label} runs cover too few sizes or thread counts to chart; the data view lists them.
					{:else}
						{store.host.id} has no {tab.label} runs.
					{/if}
				</p>
			{:else}
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
			{/if}

			<DataTable rows={scoped} />
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
		color: var(--muted);
	}
	.error {
		color: #e66767;
	}
	nav {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--rule);
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
		color: var(--muted);
		cursor: pointer;
	}
	nav button.current {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}
	.panels {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
</style>

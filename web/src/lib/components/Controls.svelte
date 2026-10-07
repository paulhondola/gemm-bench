<script lang="ts">
import type { Filters } from "../charts/spec";
import type { Tab } from "../charts/tabs";
import type { Row } from "../data/db";
import type { Family } from "../model/family";
import {
	knobLabel,
	knobNames,
	knobValues,
	knobValuesFor,
} from "../model/knobs";
import { allSizes, kernels, precisions, sizesFor } from "../model/rows";
import { atPrecision, withSize } from "../state/filters";
import { setFilters, store } from "../state/store.svelte";
import PickerGroup from "./PickerGroup.svelte";

const {
	tab,
	tabPrecisions,
	scoped,
	filters,
	family,
}: {
	tab: Tab;
	/** The precisions this tab can chart (precisionsForTab). */
	tabPrecisions: string[];
	/** The rows the tab renders (rowsForTab). */
	scoped: Row[];
	filters: Filters;
	family: Map<string, Family>;
} = $props();

const available = $derived(sizesFor(store.rows, store.precision));
// The kernel pill group is threading-tab-only and must offer only the
// kernels that tab's chart can plot — parallel-family kernels — not every
// kernel in scope.
const parallelKernelList = $derived(
	kernels(scoped).filter((k) => family.get(k) === "parallel"),
);

function pickPrecision(p: string) {
	setFilters(atPrecision(store.rows, filters, p));
}

function pickSize(s: number) {
	setFilters(withSize(store.rows, filters, s));
}
</script>

<div class="controls">
	{#if tab.controls.includes("precision") || tab.inertPrecision}
		<PickerGroup
			label="Precision"
			items={precisions(store.rows)}
			selected={store.precision}
			disabled={(p) =>
				Boolean(tab.inertPrecision) || !tabPrecisions.includes(p)}
			title={(p) =>
				tab.inertPrecision
					? "Precision is this chart's x-axis"
					: tabPrecisions.includes(p)
						? ""
						: `no ${tab.label} runs at ${p}`}
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

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
	}
	.toggle {
		font-size: 13px;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>

<script lang="ts">
import * as Plot from "@observablehq/plot";
import type { PlotSpec } from "./charts/types";

let {
	spec,
	title,
	note = "",
	empty = "No data for this selection.",
}: {
	spec: PlotSpec | null;
	title: string;
	note?: string;
	empty?: string;
} = $props();

let host = $state<HTMLDivElement | null>(null);

$effect(() => {
	if (!host) return;
	host.replaceChildren();
	if (spec) host.append(Plot.plot(spec));
});
</script>

<section class="panel">
	<header>
		<h2>{title}</h2>
		{#if note}<p class="note">{note}</p>{/if}
	</header>
	{#if spec}
		<div class="plot" bind:this={host}></div>
	{:else}
		<p class="empty">{empty}</p>
	{/if}
</section>

<style>
	.panel {
		background: #15181b;
		border: 1px solid #24292e;
		border-radius: 10px;
		padding: 20px 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		color: #e6e3dc;
	}
	.note {
		margin: 4px 0 0;
		font-size: 13px;
		color: #9aa1a8;
	}
	.empty {
		margin: 0;
		padding: 32px 0;
		text-align: center;
		color: #9aa1a8;
		font-size: 13px;
	}
</style>

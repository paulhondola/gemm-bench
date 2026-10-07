<script lang="ts">
import type { Machine } from "./data/db";
import { cacheLabel } from "./format/machine";

const { machine }: { machine: Machine } = $props();

const tierName = (tier: number | null) =>
	tier === null
		? "Shared"
		: (machine.tiers.find((t) => t.tier === tier)?.name ?? `Tier ${tier}`);
</script>

<!-- Every value here comes from a contributor's machine: text only, never {@html}. -->
<table>
	<tbody>
		<tr><th>CPU</th><td>{machine.cpu}</td></tr>
		{#each machine.tiers as t (t.tier)}
			<tr><th>{t.name ?? `Tier ${t.tier}`} cores</th><td>{t.cores} cores, {t.logical_cpus} threads</td></tr>
		{/each}
		{#each machine.caches as c, i (i)}
			<tr><th>{tierName(c.tier)} cache</th><td>{cacheLabel(c)}</td></tr>
		{/each}
		{#if machine.gpu}
			<tr><th>GPU</th><td>{machine.gpu}{machine.gpu_cores ? `, ${machine.gpu_cores} cores` : ""}</td></tr>
		{/if}
		<tr><th>OS</th><td>{machine.os}</td></tr>
		<tr><th>Build</th><td>{machine.arch} · {machine.target_features || "baseline"} · {machine.rustc_version}</td></tr>
		<tr><th>Threads available</th><td>{machine.available_parallelism}</td></tr>
		<tr><th>Recorded</th><td>{machine.started_at}</td></tr>
	</tbody>
</table>

<style>
	table {
		border-collapse: collapse;
		font-family: "IBM Plex Mono", monospace;
		font-size: 12px;
		margin: 12px 0;
	}
	th,
	td {
		padding: 4px 12px 4px 0;
		text-align: left;
		border-bottom: 1px solid #24292e;
	}
	th {
		color: #9aa1a8;
		font-weight: 500;
		white-space: nowrap;
	}
</style>

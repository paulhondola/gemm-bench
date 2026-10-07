<script lang="ts">
import { machineLabel } from "../format/machine";
import { store } from "../state/store.svelte";

/** Loads another host as a fresh page: no picker state carries over from the last one. */
function selectHost(id: string) {
	location.search = new URLSearchParams({ host: id }).toString();
}
</script>

<div class="host">
	<label>
		Host
		<select value={store.host?.id} onchange={(e) => selectHost(e.currentTarget.value)}>
			{#each store.hosts as h (h.id)}<option value={h.id}>{h.id}</option>{/each}
		</select>
	</label>
	{#if store.machine}<span>{machineLabel(store.machine)}</span>{/if}
</div>

<style>
	.host {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		font-size: 13px;
		color: var(--muted);
	}
	/* The App's muted line style, which this span had before it moved here. */
	.host span {
		margin-top: 6px;
		font-size: 14px;
	}
	.host select {
		margin-left: 6px;
		font: inherit;
	}
</style>

<script lang="ts">
import type { Row } from "../data/db";
import { formatParams } from "../format/numbers";

const { rows }: { rows: Row[] } = $props();

const columns = $derived(
	rows.length ? (Object.keys(rows[0]) as (keyof Row)[]) : [],
);

let open = $state(false);

/**
 * One data-view cell: params as name=value pairs, floats to 3 places, and
 * tiny ones (relative errors near 1e-7) in exponent form so they don't read 0.
 */
function cell(value: Row[keyof Row]): string {
	if (value !== null && typeof value === "object") return formatParams(value);
	if (typeof value === "number" && !Number.isInteger(value))
		return Math.abs(value) < 1e-3 ? value.toExponential(2) : value.toFixed(3);
	return String(value ?? "");
}
</script>

<!-- Every value is interpolated as text: kernel and device names come from
     host databases. The table is built only while open: it can run to
     thousands of rows. -->
<details bind:open>
	<summary>Data view ({rows.length} rows)</summary>
	{#if open}
	<div class="scroll">
		<table>
			<thead>
				<tr>
					{#each columns as c}<th>{c}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row}
					<tr>
						{#each columns as c}<td>{cell(row[c])}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}
</details>

<style>
	summary {
		cursor: pointer;
		color: var(--muted);
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
		border-bottom: 1px solid var(--rule);
		white-space: nowrap;
	}
	th {
		color: var(--muted);
		font-weight: 500;
	}
</style>

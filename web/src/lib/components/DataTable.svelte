<script lang="ts">
import type { Row } from "../data/db";
import { formatParams } from "../format/numbers";

const { rows }: { rows: Row[] } = $props();

const columns = $derived(
	rows.length ? (Object.keys(rows[0]) as (keyof Row)[]) : [],
);

/** One data-view cell: params as name=value pairs, floats to 3 places. */
function cell(value: Row[keyof Row]): string {
	if (value !== null && typeof value === "object") return formatParams(value);
	if (typeof value === "number" && !Number.isInteger(value))
		return value.toFixed(3);
	return String(value ?? "");
}
</script>

<!-- Every value is interpolated as text: kernel and device names come from
     host databases. -->
<details>
	<summary>Data view ({rows.length} rows)</summary>
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

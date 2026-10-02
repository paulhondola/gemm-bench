<script lang="ts">
import { fmtGops } from "./charts/overview";
import { percentOfPeak } from "./charts/types";
import type { Peak, Row } from "./db";
import type { Family } from "./derive";
import { engineRows } from "./hardware";

const {
	rows,
	peaks,
	family,
}: { rows: Row[]; peaks: Peak[]; family: Map<string, Family> } = $props();

const devices = $derived.by(() => {
	const all = engineRows(rows, peaks, family);
	return [...new Set(all.map((e) => e.device))].map((device) => ({
		device,
		engines: all.filter((e) => e.device === device),
		sources: peaks.filter((p) => p.device === device),
	}));
});
</script>

<!-- Every string here is interpolated as text: device and kernel names come
     from host databases, and peaks' sources are data too. -->
{#each devices as d (d.device)}
	{#if devices.length > 1}<h3>{d.device}</h3>{/if}
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th>Engine</th>
					<th>Precision</th>
					<th>Peak GFLOP/s</th>
					<th>Best GOP/s</th>
					<th>Reached by</th>
					<th>% of peak</th>
				</tr>
			</thead>
			<tbody>
				{#each d.engines as e (`${e.family} ${e.precision}`)}
					<tr>
						<td class="text">{e.engine}</td>
						<td class="text"><code>{e.precision}</code></td>
						<td>{e.peak ? fmtGops(e.peak.gflops) : "no published peak"}</td>
						<td>{e.best ? fmtGops(Number(e.best.gops)) : "—"}</td>
						<td class="text">
							{#if e.best}
								<code>{e.best.kernel}</code> · N = {e.best.n}
								<!-- Only the threaded CPU row's count means cores: AMX and GPU
								     rows record one calling thread. -->
								{#if e.family === "parallel"}· {e.best.threads} threads{/if}
							{:else}—{/if}
						</td>
						<td>
							{e.peak && e.best
								? `${percentOfPeak(Number(e.best.gops), e.peak.gflops)}%`
								: "—"}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if d.sources.length}
		<details>
			<summary>Where the peaks come from</summary>
			<ul>
				{#each d.sources as p (`${p.backend} ${p.precision} ${p.cores}`)}
					<li>
						<code>{p.backend} {p.precision}</code>, {p.cores}
						{p.cores === 1 ? "core" : "cores"}: {p.source}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/each}

<style>
	h3 {
		margin: 20px 0 8px;
		font-size: 15px;
		font-weight: 600;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 12px;
	}
	table {
		border-collapse: collapse;
		font-size: 13px;
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
	th:nth-child(-n + 2),
	th:nth-child(5),
	td.text {
		text-align: left;
	}
	td {
		font-family: "IBM Plex Mono", monospace;
	}
	td.text {
		font-family: inherit;
	}
	code {
		font-family: "IBM Plex Mono", monospace;
		font-size: 12px;
	}
	details {
		margin-top: 12px;
		font-size: 13px;
		color: #9aa1a8;
	}
	summary {
		cursor: pointer;
	}
	ul {
		margin: 8px 0 0;
		padding-left: 20px;
	}
	li {
		margin: 4px 0;
	}
</style>

<script lang="ts">
import { query, type Row } from "./lib/db";

let precisions: string[] = $state([]);
let sizes: number[] = $state([]);
let precision = $state("");
let n = $state(0);
let rows: Row[] = $state([]);
let error = $state("");

const columns = $derived(rows.length ? Object.keys(rows[0]) : []);

query("SELECT DISTINCT precision FROM results ORDER BY 1")
	.then(async (p) => {
		precisions = p.map((r) => String(r.precision));
		sizes = (await query("SELECT DISTINCT n FROM results ORDER BY 1")).map(
			(r) => Number(r.n),
		);
		precision = precisions[0];
		n = sizes[0];
	})
	.catch((e) => (error = String(e)));

$effect(() => {
	if (!precision) return;
	// Filter values come from the data itself, so they are safe to inline.
	query(
		`SELECT kernel, threads, median_ms, min_ms, stddev_ms, gflops
		 FROM results WHERE precision = '${precision}' AND n = ${n}
		 ORDER BY gflops DESC`,
	)
		.then((r) => (rows = r))
		.catch((e) => (error = String(e)));
});

const fmt = (v: Row[string]) =>
	typeof v === "number" && !Number.isInteger(v) ? v.toFixed(3) : v;
</script>

<main>
	<h1>gemm-bench results</h1>

	{#if error}
		<p class="error">{error}</p>
	{:else if !precisions.length}
		<p>Loading DuckDB…</p>
	{:else}
		<div class="filters">
			<label>
				Precision
				<select bind:value={precision}>
					{#each precisions as p}<option value={p}>{p}</option>{/each}
				</select>
			</label>
			<label>
				n
				<select bind:value={n}>
					{#each sizes as s}<option value={s}>{s}</option>{/each}
				</select>
			</label>
		</div>

		{#if rows.length}
			<div class="scroll">
				<table>
					<thead>
						<tr>{#each columns as c}<th>{c}</th>{/each}</tr>
					</thead>
					<tbody>
						{#each rows as row}
							<tr>{#each columns as c}<td>{fmt(row[c])}</td>{/each}</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p>No results for {precision} at n = {n}.</p>
		{/if}
	{/if}
</main>

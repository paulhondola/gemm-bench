<script lang="ts">
import type { Config } from "plotly.js-dist-min";
import Plotly from "plotly.js-dist-min";
import { escapeLabels, type Figure } from "./charts/types";

let {
	spec,
	title,
	note = "",
	empty = "No data for this selection.",
}: {
	spec: Figure | null;
	title: string;
	note?: string;
	empty?: string;
} = $props();

let host = $state<HTMLDivElement | null>(null);

/**
 * Plotly's built-ins are why the dashboard uses it: box zoom and pan,
 * double-click to reset, legend click to hide and double-click to isolate,
 * and an SVG download. The selection tools have nothing to act on, and the
 * cloud-upload button, on by default since Plotly 4, would post the chart's
 * data to cloud.plotly.com.
 */
const CONFIG: Partial<Config> = {
	displaylogo: false,
	showSendToCloud: false,
	modeBarButtonsToRemove: ["select2d", "lasso2d"],
};

$effect(() => {
	if (!host || !spec) return;
	// A copy: Plotly writes zoom state back into the layout it is handed, and
	// charts share BASE_LAYOUT's nested objects.
	const { data, layout } = escapeLabels(structuredClone(spec));
	Plotly.react(
		host,
		data,
		{
			...layout,
			// A hidden series stays hidden across filter changes (traces are
			// matched by uid); zoom resets, since the axes may hold new data.
			legend: { ...layout.legend, uirevision: title },
		},
		{ ...CONFIG, toImageButtonOptions: { format: "svg", filename: title } },
	);
});

// Its own effect: a cleanup in the draw effect would run before every redraw
// and throw away the zoom and legend state react preserves.
$effect(() => {
	const el = host;
	if (!el) return;
	// Follows the panel, not only the window (which is all Plotly's
	// `responsive` watches): the page scrollbar that appears once the charts
	// load narrows every panel without a window resize. Plots.resize rejects
	// on a div Plotly has not drawn into yet.
	const resize = new ResizeObserver(() => {
		if (el.classList.contains("js-plotly-plot")) Plotly.Plots.resize(el);
	});
	resize.observe(el);
	return () => {
		resize.disconnect();
		Plotly.purge(el);
	};
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

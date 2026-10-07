<script lang="ts">
import type { Config, PlotlyHTMLElement, Shape } from "plotly.js-dist-min";
import Plotly from "plotly.js-dist-min";
import { escapeLabels, type Figure, type Trace } from "./charts/types";
import { renderMarkdown } from "./format/markdown";

let {
	spec,
	title,
	note = "",
	doc,
	empty = "No data for this selection.",
}: {
	spec: Figure | null;
	title: string;
	note?: string;
	/** The chart's Markdown explanation, from web/src/docs/charts/. */
	doc: string;
	empty?: string;
} = $props();

const docHtml = $derived(renderMarkdown(doc));

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

/**
 * A shape in a legend group (a peak ceiling) hides with its series on a
 * legend click, but legend.uirevision restores only the traces' visibility
 * across a redraw, so a hidden series' ceiling would come back with the next
 * filter change. Each such shape follows its group's traces instead.
 */
function syncGroupedShapes(gd: PlotlyHTMLElement) {
	// The panel can unmount, and Plotly.purge clear the div, before the
	// redraw's promise settles.
	if (!gd.layout) return;
	const hidden = new Set(
		(gd.data as Trace[])
			.filter((t) => t.visible === "legendonly")
			.map((t) => t.legendgroup),
	);
	const shapes = gd.layout.shapes ?? [];
	const synced = shapes.map(
		(s): Shape =>
			s.legendgroup === undefined
				? s
				: { ...s, visible: hidden.has(s.legendgroup) ? "legendonly" : true },
	);
	if (
		synced.some((s, i) => (s.visible ?? true) !== (shapes[i].visible ?? true))
	)
		Plotly.relayout(gd, { shapes: synced });
}

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
	).then(syncGroupedShapes);
});

// Its own effect: a cleanup in the draw effect would run before every redraw
// and throw away the zoom and legend state react preserves.
$effect(() => {
	const el = host;
	if (!el) return;
	// Follows the panel, not only the window (which is all Plotly's
	// `responsive` watches): the page scrollbar that appears once the charts
	// load narrows every panel without a window resize. The guard skips a div
	// Plotly hasn't drawn into yet, where a resize would do nothing.
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
	<!-- Outside the {#if spec} below, so an empty selection still explains the
	     chart. The HTML is the dashboard's own Markdown, never contributed data. -->
	<details class="doc">
		<summary>How to read this chart</summary>
		<div class="prose">{@html docHtml}</div>
	</details>
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
	.doc summary {
		cursor: pointer;
		font-size: 13px;
		color: #9aa1a8;
	}
	.prose {
		max-width: 72ch;
		margin-top: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
	.prose :global(p) {
		margin: 0 0 10px;
	}
	.prose :global(code) {
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
	}
	.empty {
		margin: 0;
		padding: 32px 0;
		text-align: center;
		color: #9aa1a8;
		font-size: 13px;
	}
</style>

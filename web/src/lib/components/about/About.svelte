<script lang="ts">
import about from "../../../docs/about.md?raw";
import hardware from "../../../docs/hardware.md?raw";
import type { Machine, Peak, Row } from "../../data/db";
import { FAMILY_INK } from "../../design/palette";
import { renderMarkdown } from "../../format/markdown";
import type { Family } from "../../model/family";
import HardwareTable from "./HardwareTable.svelte";
import { KERNEL_DOCS } from "./kernelDocs";
import MachineTable from "./MachineTable.svelte";

const {
	rows,
	peaks,
	family,
	machine,
}: {
	rows: Row[];
	peaks: Peak[];
	family: Map<string, Family>;
	machine: Machine | undefined;
} = $props();

// Each file's "## `<kernel>`" renders as an h4, under the page's h2 and the
// family's h3.
const families = KERNEL_DOCS.map((g) => ({
	...g,
	html: renderMarkdown(g.doc, 2),
}));
</script>

<article>
	<!-- The dashboard's own Markdown, never contributed data. -->
	<div class="intro prose">{@html renderMarkdown(about)}</div>

	<section class="panel">
		<h2>Hardware tested</h2>
		<div class="prose">{@html renderMarkdown(hardware, 2)}</div>
		{#if machine}<MachineTable {machine} />{/if}
		<HardwareTable {rows} {peaks} {family} />
	</section>

	<section class="panel">
		<h2>Kernels</h2>
		{#each families as g (g.family)}
			<h3>
				<span class="dot" style:background={FAMILY_INK[g.family]}></span>
				<code>{g.family}</code> · {g.title}
			</h3>
			<!-- The dashboard's own Markdown, never contributed data. -->
			<div class="prose family">{@html g.html}</div>
		{/each}
	</section>
</article>

<style>
	article {
		display: flex;
		flex-direction: column;
		gap: 20px;
		font-size: 14px;
		line-height: 1.6;
	}
	.intro {
		max-width: 72ch;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 10px;
		padding: 20px 24px;
	}
	.panel > * {
		max-width: 72ch;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}
	h3 {
		margin: 28px 0 4px;
		font-size: 15px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	code,
	.prose :global(code) {
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	/* A family file opens with its blurb. */
	.family > :global(p:first-child) {
		margin-top: 0;
		color: var(--muted);
	}
	.prose :global(p) {
		margin: 8px 0;
	}
	.prose :global(h4) {
		margin: 20px 0 4px;
		font-size: 14px;
		font-weight: 600;
	}
	.prose :global(pre) {
		margin: 8px 0;
		padding: 10px 14px;
		overflow-x: auto;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 6px;
		line-height: 1.45;
	}
	.prose :global(ul) {
		margin: 8px 0;
		padding-left: 20px;
	}
	.prose :global(a) {
		color: var(--ink);
	}
	.prose :global(table) {
		margin: 12px 0;
		border-collapse: collapse;
		font-size: 13px;
	}
	.prose :global(th),
	.prose :global(td) {
		padding: 6px 12px 6px 0;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--rule);
	}
	.prose :global(th) {
		color: var(--muted);
		font-weight: 500;
	}
</style>

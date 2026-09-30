<script lang="ts">
import { KERNEL_DOCS } from "./docs";
import { renderMarkdown } from "./markdown";
import { FAMILY_INK } from "./palette";

// Each file's "## `<kernel>`" renders as an h4, under the page's h2 and the
// family's h3.
const families = KERNEL_DOCS.map((g) => ({
	...g,
	html: renderMarkdown(g.doc, 2),
}));
</script>

<article>
	<p class="intro">
		gemm-bench times one operation, C = A × B on square N × N matrices,
		implemented many ways: from textbook loops on one CPU core up to Apple's
		AMX coprocessor and GPU. Throughput is in GOP/s: billions of operations per
		second, counting N³ multiplies and N³ adds against the median of several
		timed runs. Higher is better.
	</p>

	<section class="panel">
		<h2>Kernels</h2>
		{#each families as g (g.family)}
			<h3>
				<span class="dot" style:background={FAMILY_INK[g.family]}></span>
				<code>{g.family}</code> · {g.title}
			</h3>
			<!-- The dashboard's own Markdown, never contributed data. -->
			<div class="prose">{@html g.html}</div>
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
		margin: 0;
		max-width: 72ch;
	}
	.panel {
		background: #15181b;
		border: 1px solid #24292e;
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
	.prose > :global(p:first-child) {
		margin-top: 0;
		color: #9aa1a8;
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
		background: #0e1012;
		border: 1px solid #24292e;
		border-radius: 6px;
		line-height: 1.45;
	}
	.prose :global(ul) {
		margin: 8px 0;
		padding-left: 20px;
	}
	.prose :global(a) {
		color: #e6e3dc;
	}
</style>

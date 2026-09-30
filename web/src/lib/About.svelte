<script lang="ts">
import { KERNEL_DOCS } from "./docs";
import { FAMILY_INK } from "./palette";
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
		{#each KERNEL_DOCS as group (group.family)}
			<h3>
				<span class="dot" style:background={FAMILY_INK[group.family]}></span>
				<code>{group.family}</code> · {group.title}
			</h3>
			<p class="muted">{group.blurb}</p>
			<dl>
				{#each group.kernels as k (k.name)}
					<dt><code>{k.name}</code></dt>
					<dd>{k.what}</dd>
					<dd class="muted">Runs via: {k.via}</dd>
				{/each}
			</dl>
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
		margin: 20px 0 4px;
		font-size: 15px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	p {
		margin: 0;
	}
	code {
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.muted {
		color: #9aa1a8;
	}
	dl {
		margin: 12px 0 0;
	}
	dt {
		margin-top: 14px;
		font-weight: 600;
	}
	dd {
		margin: 2px 0 0 16px;
	}
</style>

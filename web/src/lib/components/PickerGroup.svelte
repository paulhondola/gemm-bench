<script lang="ts" generics="T extends string | number">
interface Props {
	label: string;
	items: T[];
	selected: T;
	onSelect: (item: T) => void;
	disabled?: (item: T) => boolean;
	title?: (item: T) => string;
	format?: (item: T) => string;
}

const {
	label,
	items,
	selected,
	onSelect,
	disabled = () => false,
	title = () => "",
	format = (item: T) => String(item),
}: Props = $props();
</script>

<div class="group" role="group" aria-label={label}>
	{#each items as item}
		<button
			type="button"
			disabled={disabled(item)}
			title={title(item)}
			aria-pressed={item === selected}
			class:on={item === selected}
			onclick={() => onSelect(item)}>{format(item)}</button>
	{/each}
</div>

<style>
	.group {
		display: flex;
		gap: 6px;
		padding: 3px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 8px;
	}
	.group button {
		min-height: 36px;
		padding: 0 14px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--muted);
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
		cursor: pointer;
	}
	.group button.on {
		background: var(--ink);
		color: var(--bg);
	}
	.group button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>

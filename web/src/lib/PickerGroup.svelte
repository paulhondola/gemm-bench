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
		background: #15181b;
		border: 1px solid #24292e;
		border-radius: 8px;
	}
	.group button {
		min-height: 36px;
		padding: 0 14px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #9aa1a8;
		font-family: "IBM Plex Mono", monospace;
		font-size: 13px;
		cursor: pointer;
	}
	.group button.on {
		background: #e6e3dc;
		color: #0e1012;
	}
	.group button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	// GitHub Pages serves this project site under /gemm-bench/, not the domain root.
	base: "/gemm-bench/",
	plugins: [svelte()],
	build: {
		// Plotly's bundle is ~5 MB minified. The size is accepted (the DuckDB
		// wasm beside it is 34 MB), so don't warn about it on every build.
		chunkSizeWarningLimit: 6000,
	},
});

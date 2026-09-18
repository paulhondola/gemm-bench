import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	// GitHub Pages serves this project site under /gemm-bench/, not the domain root.
	base: "/gemm-bench/",
	plugins: [svelte()],
});

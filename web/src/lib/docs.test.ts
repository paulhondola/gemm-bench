import { expect, test } from "bun:test";
import { KERNEL_DOCS } from "./docs";
import { FAMILY_ORDER } from "./palette";

/** One section per kernel, headed "## `<label>`". */
const sections = KERNEL_DOCS.flatMap((g) =>
	g.doc
		.split(/^(?=## )/m)
		.slice(1)
		.map((body) => ({ name: body.match(/^## `?([^`\s]+)`?/)?.[1], body })),
);
const documented = sections.map((s) => s.name);

test("the catalogue documents exactly the kernels in kernel.rs", async () => {
	// Every KernelInfo row in KernelChoice::info passes through serial("<label>").
	const source = await Bun.file(
		new URL("../../../benchmark/src/kernel.rs", import.meta.url),
	).text();
	const labels = [...source.matchAll(/serial\("([^"]+)"\)/g)].map((m) => m[1]);
	expect(labels.length).toBeGreaterThan(0);
	expect([...new Set(documented)].sort()).toEqual([...new Set(labels)].sort());
});

test("no kernel is documented twice", () => {
	expect(new Set(documented).size).toBe(documented.length);
});

test("every family has a title and a blurb, and every kernel says how it runs", () => {
	for (const g of KERNEL_DOCS) {
		expect(g.title).not.toBe("");
		// The blurb is everything before the first kernel section.
		expect(g.doc.split(/^## /m)[0].trim()).not.toBe("");
	}
	for (const s of sections) expect(s.body).toContain("**Runs via:**");
});

test("families appear once each, in FAMILY_ORDER", () => {
	expect(KERNEL_DOCS.map((g) => g.family)).toEqual(FAMILY_ORDER);
});

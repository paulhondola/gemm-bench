import { expect, test } from "bun:test";
import { KERNEL_DOCS } from "./docs";
import { FAMILY_ORDER } from "./palette";

const documented = KERNEL_DOCS.flatMap((g) => g.kernels.map((k) => k.name));

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

test("every entry has text", () => {
	for (const g of KERNEL_DOCS) {
		expect(g.title).not.toBe("");
		expect(g.blurb).not.toBe("");
		for (const k of g.kernels) {
			expect(k.what).not.toBe("");
			expect(k.via).not.toBe("");
		}
	}
});

test("families appear once each, in FAMILY_ORDER", () => {
	expect(KERNEL_DOCS.map((g) => g.family)).toEqual(FAMILY_ORDER);
});

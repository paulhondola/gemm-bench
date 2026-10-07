import { expect, test } from "bun:test";
import { formatBytes, formatParams, percentOfPeak } from "./numbers";

test("formatBytes picks the largest whole unit", () => {
	expect(formatBytes(65536)).toBe("64 KB");
	expect(formatBytes(12582912)).toBe("12 MB");
	expect(formatBytes(1310720)).toBe("1280 KB");
	expect(formatBytes(100)).toBe("100 B");
});

test("formatParams lists name=value pairs", () => {
	expect(formatParams({ depth_block: 256, register_cols: 12 })).toBe(
		"depth_block=256 register_cols=12",
	);
	expect(formatParams({})).toBe("");
});

test("percent of peak is rounded to 2 significant figures", () => {
	expect(percentOfPeak(197, 777.216)).toBe(25);
	expect(percentOfPeak(3436, 5308.416)).toBe(65);
	expect(percentOfPeak(1050, 1000)).toBe(110);
});

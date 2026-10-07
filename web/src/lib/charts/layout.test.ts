import { expect, test } from "bun:test";
import { log2Axis } from "./layout";

test("the log2 axis ticks exactly the measured sizes, as plain integers", () => {
	const axis = log2Axis([64, 128, 4096], "N");
	expect(axis.type).toBe("log");
	expect(axis.tickvals).toEqual([64, 128, 4096]);
	expect(axis.ticktext).toEqual(["64", "128", "4096"]);
});

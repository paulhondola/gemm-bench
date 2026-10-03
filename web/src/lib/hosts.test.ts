import { expect, test } from "bun:test";
import { hostsFrom, pickHost } from "./hosts";

const hosts = hostsFrom({
	"../../../data/db/zed/box.sqlite": "/a.sqlite",
	"../../../data/db/alice/m1.sqlite": "/b.sqlite",
	"../../../data/db/stray.sqlite": "/c.sqlite",
});

test("host ids come from the database paths, sorted", () => {
	expect(hosts).toEqual([
		{ id: "alice/m1", url: "/b.sqlite" },
		{ id: "zed/box", url: "/a.sqlite" },
	]);
});

test("?host= picks a listed host, and anything else falls back to the first", () => {
	expect(pickHost(hosts, "?host=zed%2Fbox")?.id).toBe("zed/box");
	expect(pickHost(hosts, "?host=nobody%2Fx")?.id).toBe("alice/m1");
	expect(pickHost(hosts, "")?.id).toBe("alice/m1");
	expect(pickHost([], "?host=zed%2Fbox")).toBeUndefined();
});

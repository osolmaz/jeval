import { describe, expect, it } from "vitest";
import { action, buildMenu, MenuError, type State } from "../../src/core/index.ts";
import { type Facts, lookUp } from "../helpers/fakes.ts";

const state = (facts: Record<string, string>, taken: string[] = []): State<Facts> => ({
	workspace: { facts },
	log: taken.map((key) => ({ action: "look-up", key: `look-up:${key}`, observation: { source: key, text: "" } })),
});

const prioritized = action<Facts, number>({
	name: "ranked",
	options: () =>
		[3, 0, 2, 1].map((priority) => ({
			key: String(priority),
			text: `priority ${String(priority)}`,
			arg: priority,
			priority,
		})),
	observe: (_, priority) => ({ source: "ranked", text: String(priority) }),
});

describe("buildMenu", () => {
	it("lists every available option with the action's name in its key", () => {
		const menu = buildMenu([lookUp], state({ a: "1", b: "2" }), 10);
		expect(menu.map((item) => item.key)).toEqual(["look-up:a", "look-up:b"]);
		expect(menu[0]).toMatchObject({ action: "look-up", text: "Look up a", informs: ["a"], priority: 0 });
	});

	it("leaves out the steps already taken", () => {
		expect(buildMenu([lookUp], state({ a: "1", b: "2" }, ["a"]), 10).map((item) => item.key)).toEqual(["look-up:b"]);
	});

	it("keeps the options of lowest priority value when it must cut, in their listed order", () => {
		const menu = buildMenu([prioritized], state({}), 2);
		expect(menu.map((item) => item.text)).toEqual(["priority 0", "priority 1"]);
	});

	it("keeps the first listed options when their priorities tie", () => {
		const tied = action<Facts, number>({
			name: "tied",
			options: () => [1, 2, 3, 4].map((n) => ({ key: String(n), text: `option ${String(n)}`, arg: n })),
			observe: () => ({ source: "", text: "" }),
		});
		expect(buildMenu([tied], state({}), 2).map((item) => item.text)).toEqual(["option 1", "option 2"]);
	});

	it("keeps no option when there is no room", () => {
		expect(buildMenu([prioritized], state({}), 0)).toEqual([]);
	});

	it("skips an action whose condition does not hold", () => {
		const closed = action<Facts, null>({
			name: "closed",
			when: () => false,
			options: () => [{ key: "x", text: "x", arg: null }],
			observe: () => ({ source: "", text: "" }),
		});
		expect(buildMenu([closed], state({}), 10)).toEqual([]);
	});

	it("refuses two options with the same key or the same text", () => {
		const twice = action<Facts, null>({
			name: "twice",
			options: () => [
				{ key: "x", text: "one", arg: null },
				{ key: "x", text: "two", arg: null },
			],
			observe: () => ({ source: "", text: "" }),
		});
		const echo = action<Facts, null>({
			name: "echo",
			options: () => [
				{ key: "x", text: "same", arg: null },
				{ key: "y", text: "same", arg: null },
			],
			observe: () => ({ source: "", text: "" }),
		});
		expect(() => buildMenu([twice], state({}), 10)).toThrow(new MenuError("two options share the key twice:x"));
		expect(() => buildMenu([twice], state({}), 10)).toThrow(expect.objectContaining({ name: "MenuError" }));
		expect(() => buildMenu([echo], state({}), 10)).toThrow(/share the text/);
	});

	it("runs a chosen option against the workspace", async () => {
		const [item] = buildMenu([lookUp], state({ a: "fact a" }), 10);
		await expect(item?.run()).resolves.toEqual({ source: "a", text: "fact a" });
	});
});

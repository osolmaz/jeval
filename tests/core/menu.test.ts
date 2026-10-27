import { describe, expect, it } from "vitest";
import { buildMenu, choiceKind, joinMenus, MenuError, type Step } from "../../src/core/index.ts";
import { type Facts, lookUp } from "../helpers/fakes.ts";

const world = (facts: Record<string, string>): Facts => ({ facts });
const history = (taken: string[] = []): Step[] =>
	taken.map((key) => ({ kind: "look-up", key: `look-up:${key}`, observation: { source: key, text: "" } }));

const prioritized = choiceKind<Facts, number>({
	name: "ranked",
	menu: () =>
		[3, 0, 2, 1].map((priority) => ({
			key: String(priority),
			text: `priority ${String(priority)}`,
			arg: priority,
			priority,
		})),
	run: (_, priority) => ({ source: "ranked", text: String(priority) }),
});

describe("buildMenu", () => {
	it("lists every choice of the domain's menu with its kind's name in its key", () => {
		const menu = buildMenu(lookUp, world({ a: "1", b: "2" }), history(), 10);
		expect(menu.map((choice) => choice.key)).toEqual(["look-up:a", "look-up:b"]);
		expect(menu[0]).toMatchObject({ kind: "look-up", text: "Look up a", priority: 0 });
	});

	it("leaves out the choices already taken", () => {
		const menu = buildMenu(lookUp, world({ a: "1", b: "2" }), history(["a"]), 10);
		expect(menu.map((choice) => choice.key)).toEqual(["look-up:b"]);
	});

	it("keeps the choices of lowest priority value when it must cut, in their listed order", () => {
		const menu = buildMenu(prioritized, world({}), history(), 2);
		expect(menu.map((choice) => choice.text)).toEqual(["priority 0", "priority 1"]);
	});

	it("keeps the first listed choices when their priorities tie", () => {
		const tied = choiceKind<Facts, number>({
			name: "tied",
			menu: () => [1, 2, 3, 4].map((n) => ({ key: String(n), text: `choice ${String(n)}`, arg: n })),
			run: () => ({ text: "" }),
		});
		expect(buildMenu(tied, world({}), history(), 2).map((choice) => choice.text)).toEqual(["choice 1", "choice 2"]);
	});

	it("keeps no choice when there is no room", () => {
		expect(buildMenu(prioritized, world({}), history(), 0)).toEqual([]);
	});

	it("leaves out a kind whose condition does not hold", () => {
		const closed = choiceKind<Facts, null>({
			name: "closed",
			when: () => false,
			menu: () => [{ key: "x", text: "x", arg: null }],
			run: () => ({ text: "" }),
		});
		expect(buildMenu(closed, world({}), history(), 10)).toEqual([]);
	});

	it("joins the menus of several kinds in their order", () => {
		const menu = buildMenu(joinMenus(prioritized, lookUp), world({ a: "1" }), history(), 10);
		expect(menu.map((choice) => choice.kind)).toEqual(["ranked", "ranked", "ranked", "ranked", "look-up"]);
		expect(joinMenus(lookUp, prioritized)(world({ a: "1" }), [])[0]?.kind).toBe("look-up");
	});

	it("refuses two choices with the same key or the same text", () => {
		const twice = choiceKind<Facts, null>({
			name: "twice",
			menu: () => [
				{ key: "x", text: "one", arg: null },
				{ key: "x", text: "two", arg: null },
			],
			run: () => ({ text: "" }),
		});
		const echo = choiceKind<Facts, null>({
			name: "echo",
			menu: () => [
				{ key: "x", text: "same", arg: null },
				{ key: "y", text: "same", arg: null },
			],
			run: () => ({ text: "" }),
		});
		expect(() => buildMenu(twice, world({}), history(), 10)).toThrow(
			new MenuError("two choices share the key twice:x"),
		);
		expect(() => buildMenu(twice, world({}), history(), 10)).toThrow(expect.objectContaining({ name: "MenuError" }));
		expect(() => buildMenu(echo, world({}), history(), 10)).toThrow(/share the text/);
	});

	it("runs a chosen choice against the world", async () => {
		const [choice] = buildMenu(lookUp, world({ a: "fact a" }), history(), 10);
		await expect(choice?.run()).resolves.toEqual({ source: "a", text: "fact a" });
	});
});

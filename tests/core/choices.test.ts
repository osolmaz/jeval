import { describe, expect, it } from "vitest";
import { type Choice, ChoiceError, choiceType, joinTypes, offerChoices } from "../../src/core/index.ts";
import { type FactsState, lookUp } from "../helpers/fakes.ts";

const empty: FactsState = { looked: [], found: [] };
const none = new Set<string>();

const ranked = choiceType<FactsState, number>({
	type: "ranked",
	choices: () =>
		[3, 0, 2, 1].map((priority) => ({
			key: String(priority),
			text: `priority ${String(priority)}`,
			arg: priority,
			priority,
		})),
	transition: (state, priority) => ({ ...state, found: [...state.found, String(priority)] }),
});

const choice = (key: string, text = key): Choice => ({ type: "test", key, text });

describe("offerChoices", () => {
	it("keeps the choice function's choices in their order", () => {
		const { choices } = joinTypes(lookUp({ facts: { a: "1", b: "2" } }));
		const offered = offerChoices(choices(empty), none, 10);
		expect(offered.map((offer) => offer.key)).toEqual(["look-up:a", "look-up:b"]);
		expect(offered[0]).toMatchObject({ type: "look-up", text: "Look up a" });
	});

	it("keeps the choices of lowest priority value when it must cut, in their listed order", () => {
		const offered = offerChoices(joinTypes(ranked).choices(empty), none, 2);
		expect(offered.map((offer) => offer.text)).toEqual(["priority 0", "priority 1"]);
	});

	it("keeps the first listed choices when their priorities tie, and none when there is no room", () => {
		const tied = [1, 2, 3, 4].map((n) => choice(String(n)));
		expect(offerChoices(tied, none, 2).map((offer) => offer.key)).toEqual(["1", "2"]);
		expect(offerChoices(tied, none, 0)).toEqual([]);
	});

	it("refuses two choices with one key or one text, a key picked before, and the stop key", () => {
		expect(() => offerChoices([choice("x", "one"), choice("x", "two")], none, 10)).toThrow(
			new ChoiceError("two choices share the key x"),
		);
		expect(() => offerChoices([choice("x", "same"), choice("y", "same")], none, 10)).toThrow(/share the text/);
		expect(() => offerChoices([choice("x")], new Set(["x"]), 10)).toThrow(
			"the choice x was picked before in this run",
		);
		expect(() => offerChoices([choice("stop")], none, 10)).toThrow(expect.objectContaining({ name: "ChoiceError" }));
	});
});

describe("joinTypes", () => {
	it("joins the choices of several types in their order, each with its type in its key", () => {
		const { choices } = joinTypes(ranked, lookUp({ facts: { a: "1" } }));
		expect(choices(empty).map((offer) => offer.type)).toEqual(["ranked", "ranked", "ranked", "ranked", "look-up"]);
		expect(joinTypes(lookUp({ facts: { a: "1" } }), ranked).choices(empty)[0]?.key).toBe("look-up:a");
	});

	it("gives each choice to the transition of its type", async () => {
		const { choices, transition } = joinTypes(ranked, lookUp({ facts: { a: "fact a" } }));
		const [first] = choices(empty);
		const last = choices(empty).at(-1);
		if (first === undefined || last === undefined) throw new Error("no choices");
		await expect(transition(empty, first)).resolves.toEqual({ looked: [], found: ["3"] });
		await expect(transition(empty, last)).resolves.toEqual({ looked: ["a"], found: ["fact a"] });
	});
});

import { describe, expect, it } from "vitest";
import {
	type Choice,
	ChoiceError,
	choiceType,
	joinTypes,
	offerChoices,
	PICK_ID,
	pickedChoice,
	picking,
	pickQuestion,
	typedKey,
} from "../../src/core/index.ts";
import { type FactsState, lookUp, START } from "../helpers/fakes.ts";

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
const answer = (label: string) => ({ type: "choice" as const, choice: label, probabilities: {}, confidence: 1 });

describe("offerChoices", () => {
	it("keeps the choice function's choices in their order", () => {
		const { choices } = joinTypes(lookUp({ facts: { a: "1", b: "2" } }));
		const offered = offerChoices(choices(START), 10);
		expect(offered.map((offer) => offer.key)).toEqual(["look-up:a", "look-up:b"]);
		expect(offered[0]).toMatchObject({ type: "look-up", text: "Look up a" });
	});

	it("keeps the choices of lowest priority value when it must cut, in their listed order", () => {
		const offered = offerChoices(joinTypes(ranked).choices(START), 2);
		expect(offered.map((offer) => offer.text)).toEqual(["priority 0", "priority 1"]);
	});

	it("keeps the first listed choices when their priorities tie, and none when there is no room", () => {
		const tied = [1, 2, 3, 4].map((n) => choice(String(n)));
		expect(offerChoices(tied, 2).map((offer) => offer.key)).toEqual(["1", "2"]);
		expect(offerChoices(tied, 0)).toEqual([]);
	});

	it("refuses two choices with one key or one text, which a label could not tell apart", () => {
		expect(() => offerChoices([choice("x", "one"), choice("x", "two")], 10)).toThrow(
			new ChoiceError("two choices share the key x"),
		);
		expect(() => offerChoices([choice("x", "same"), choice("y", "same")], 10)).toThrow(/share the text/);
	});
});

describe("pickQuestion", () => {
	it("asks one choice question under the labels o1, o2…, with what each label stands for in its data", () => {
		const pick = pickQuestion([choice("x", "Do x"), { ...choice("y", "Do y"), data: { n: 1 } }], "Pick one.", 5);
		expect(pick?.question).toEqual({
			type: "choice",
			instructions: "Pick one.",
			criteria: { o1: "Do x", o2: "Do y" },
			data: { choices: { o1: { key: "x", type: "test" }, o2: { key: "y", type: "test", data: { n: 1 } } } },
		});
		expect(pick?.choices.map((offer) => offer.key)).toEqual(["x", "y"]);
	});

	it("says how many choices its limit cut, and is null when there is no choice", () => {
		const pick = pickQuestion(joinTypes(ranked).choices(START), "Pick.", 3);
		expect(pick?.question.data).toMatchObject({ cut: 1 });
		expect(pickQuestion([], "Pick.", 3)).toBeNull();
	});
});

describe("pickedChoice", () => {
	const pick = pickQuestion([choice("x"), choice("y")], "Pick.", 5);
	if (pick === null) throw new Error("no pick");

	it("finds the choice behind the answer's label", () => {
		expect(pickedChoice(pick, answer("o2")).key).toBe("y");
	});

	it("refuses an answer that is no choice answer or names no label of the pick", () => {
		expect(() => pickedChoice(pick, undefined)).toThrow(new ChoiceError("the pick has no choice answer"));
		expect(() => pickedChoice(pick, { type: "bool", probability: 1 })).toThrow("the pick has no choice answer");
		expect(() => pickedChoice(pick, answer("o3"))).toThrow("the label o3 is none of the pick's choices");
	});
});

describe("picking", () => {
	const machine = picking({
		instructions: "Pick a fact.",
		limit: 10,
		...joinTypes(lookUp({ facts: { a: "fact a" } })),
	});

	it("asks one pick in a state with choices, under the pick's id, and nothing in a state without", () => {
		expect(Object.keys(machine.questions(START))).toEqual([PICK_ID]);
		expect(machine.questions({ ...START, looked: ["a"] })).toEqual({});
		const named = picking({
			id: "next",
			instructions: "Pick.",
			limit: 10,
			...joinTypes(lookUp({ facts: { a: "x" } })),
		});
		expect(Object.keys(named.questions(START))).toEqual(["next"]);
	});

	it("gives the picked choice to the transition", async () => {
		await expect(machine.transition(START, { [PICK_ID]: answer("o1") })).resolves.toMatchObject({
			looked: ["a"],
			found: ["fact a"],
		});
		expect(() => machine.transition({ ...START, looked: ["a"] }, {})).toThrow(
			"the state has no choices to pick from",
		);
	});
});

describe("joinTypes", () => {
	it("joins the choices of several types in their order, each with its type in its key", () => {
		const { choices } = joinTypes(ranked, lookUp({ facts: { a: "1" } }));
		expect(choices(START).map((offer) => offer.type)).toEqual(["ranked", "ranked", "ranked", "ranked", "look-up"]);
		expect(joinTypes(lookUp({ facts: { a: "1" } }), ranked).choices(START)[0]?.key).toBe("look-up:a");
	});

	it("gives each choice to the transition of its type", async () => {
		const { choices, transition } = joinTypes(ranked, lookUp({ facts: { a: "fact a" } }));
		const [first] = choices(START);
		const last = choices(START).at(-1);
		if (first === undefined || last === undefined) throw new Error("no choices");
		await expect(transition(START, first)).resolves.toMatchObject({ looked: [], found: ["3"] });
		await expect(transition(START, last)).resolves.toMatchObject({ looked: ["a"], found: ["fact a"] });
	});

	it("gives a type's transition the picked choice's key, as typedKey makes it", async () => {
		const keyed = choiceType<FactsState, string>({
			type: "note",
			choices: () => [{ key: "x", text: "Note x", arg: "x" }],
			transition: (state, _arg, key) => ({ ...state, looked: [...state.looked, key] }),
		});
		const { choices, transition } = joinTypes(keyed);
		const [only] = choices(START);
		if (only === undefined) throw new Error("no choices");
		expect(only.key).toBe(typedKey("note", "x"));
		await expect(transition(START, only)).resolves.toMatchObject({ looked: ["note:x"] });
	});
});

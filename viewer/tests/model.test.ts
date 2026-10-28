import { describe, expect, it } from "vitest";
import { answerText, changesOf, momentsOf, percent, pickProbabilities, plain, ranked } from "../src/web/model.ts";
import { factsSession } from "./helpers/sessions.ts";

describe("moments", () => {
	it("are the start, every step and, once the case has finished, the end", async () => {
		const session = await factsSession({ steps: 2 });
		expect(momentsOf(session.story, true).map((moment) => moment.label)).toEqual([
			"Start",
			"Step 1 of 3",
			"Step 2 of 3",
			"Step 3 of 3",
			"End",
		]);
		expect(momentsOf(session.story, false).map((moment) => moment.label)).toEqual([
			"Start",
			"Step 1",
			"Step 2",
			"Step 3",
		]);
		expect(pickProbabilities(session.story)).toEqual([0.9, 0.9, 0.9]);
	});
});

describe("text", () => {
	it("writes probabilities, answers and outcome values", () => {
		expect([percent(null), percent(0.5), percent(0.0004)]).toEqual(["–", "50.0%", "0.04%"]);
		expect(answerText({ type: "bool", probability: 0.25 })).toBe("yes 25.0%");
		expect(answerText({ type: "choice", choice: "b", probabilities: { b: 0.6 }, confidence: 0.4 })).toBe("b 60.0%");
		expect(answerText({ type: "choice", choice: "c", probabilities: {}, confidence: 0 })).toBe("c –");
		expect(answerText({ type: "score", score: 1.5, confidence: 0.4 })).toBe("1.50 (confidence 40.0%)");
		expect(plain([1, "a", { b: true }])).toBe("1, a, b true");
		expect(plain(null)).toBe("null");
	});

	it("ranks choices by probability, with unanswered ones last", () => {
		const choice = (key: string, probability: number | null) => ({
			key,
			text: key,
			probability,
			picked: false,
			data: null,
		});
		expect(ranked([choice("a", null), choice("b", 0.2), choice("c", 0.7)]).map((item) => item.key)).toEqual([
			"c",
			"b",
			"a",
		]);
	});
});

describe("changesOf", () => {
	it("gives the new value of each changed field, and the new entries of a list that only grew", () => {
		const before = { looked: ["a"], last: "a", same: 1, gone: true };
		const after = { looked: ["a", "b", "c"], last: "c", same: 1, added: { x: 1 } };
		expect(changesOf(before, after)).toEqual(["looked + b", "looked + c", "last: c", "added: x 1", "gone: removed"]);
	});

	it("gives a list's whole value when it changed in another way, and every field when there was no state", () => {
		expect(changesOf({ list: ["a", "b"] }, { list: ["b"] })).toEqual(["list: b"]);
		expect(changesOf({ list: "a" }, { list: ["a"] })).toEqual(["list: a"]);
		expect(changesOf(null, { n: 1 })).toEqual(["n: 1"]);
		expect(changesOf({ n: 1 }, { n: 1 })).toEqual([]);
	});
});

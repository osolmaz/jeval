import { describe, expect, it } from "vitest";
import { answerText, confidence, momentsOf, percent, plain, ranked } from "../../src/view/web/model.ts";
import { factsSession } from "../helpers/sessions.ts";

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
		expect(confidence(session.story)).toEqual([0.9, 0.9, 0.9]);
	});
});

describe("text", () => {
	it("writes probabilities, answers and outcome values", () => {
		expect([percent(null), percent(0.5), percent(0.0004)]).toEqual(["–", "50.0%", "0.04%"]);
		expect(answerText({ type: "bool", probability: 0.25 })).toBe("yes 25.0%");
		expect(answerText({ type: "choice", choice: "b", probabilities: { b: 0.6 } })).toBe("b 60.0%");
		expect(answerText({ type: "choice", choice: "c", probabilities: {} })).toBe("c –");
		expect(answerText({ type: "score", score: 1.5, confidence: 0.4 })).toBe("1.50 (confidence 40.0%)");
		expect(plain([1, "a", { b: true }])).toBe("1, a, b true");
		expect(plain(null)).toBe("null");
	});

	it("ranks choices by probability, with unanswered ones last", () => {
		const choice = (key: string, probability: number | null) => ({
			key,
			text: key,
			probability,
			chosen: false,
			data: null,
		});
		expect(ranked([choice("a", null), choice("b", 0.2), choice("c", 0.7)]).map((item) => item.key)).toEqual([
			"c",
			"b",
			"a",
		]);
	});
});

import { describe, expect, it } from "vitest";
import { type Answer, type DecisionRequest, run, STOP_KEY } from "../../../src/core/index.ts";
import { createLegalJudge } from "../../../src/domains/legal-judge/index.ts";
import { checkLines, checkQuestions } from "../../../src/domains/legal-judge/judge.ts";
import { cutsFrom, highlight, partsOf, windowQuestions, wordsOf } from "../../../src/domains/legal-judge/split.ts";
import { fakeDecider } from "../../helpers/fakes.ts";
import { legalCase, workspaceOf } from "../../helpers/cases.ts";

const ITEM = {
	id: "S-001",
	category: "substance",
	text: "PASS if the memo states the notice period, the deadline and the governing law.",
};
const words = wordsOf(ITEM.text);

const usage = { inputTokens: 1, milliseconds: 1 };
/** Picks a gap in the item's windows, accepts splits, and answers checks by their id. */
function staged(request: DecisionRequest): { ok: true; answers: Record<string, Answer>; usage: typeof usage } {
	const answers: Record<string, Answer> = {};
	for (const question of request.questions) {
		if (question.kind === "choice") {
			const gap =
				question.id === "next"
					? STOP_KEY
					: question.id.startsWith("S-001/w") && "g8" in question.choices
						? "g8"
						: "none";
			answers[question.id] = { kind: "choice", choice: gap, probabilities: { [gap]: 0.9 } };
		} else {
			const probability = question.id.endsWith("/part2") || question.id.endsWith("/misses") ? 0.2 : 0.8;
			answers[question.id] = { kind: "bool", probability };
		}
	}
	return { ok: true, answers, usage };
}

describe("splitting", () => {
	it("asks one choice per overlapping window, quoting the words around each gap", () => {
		const questions = windowQuestions(ITEM, words);
		expect(questions.map((question) => question.id)).toEqual(["S-001/w3", "S-001/w9"]);
		expect(questions[0]?.choices["g8"]).toBe('Between "states the notice period," and "the deadline and the"');
		expect(questions[0]?.choices["none"]).toBe("No new requirement starts inside this stretch.");
		expect(windowQuestions({ ...ITEM, text: "PASS if" }, ["PASS", "if"])).toEqual([]);
	});

	it("keeps strong picks, merges neighbours into the strongest, and ignores none", () => {
		const questions = windowQuestions(ITEM, words);
		const pick = (choice: string, p: number): Answer => ({ kind: "choice", choice, probabilities: { [choice]: p } });
		expect(cutsFrom({ "S-001/w3": pick("g8", 0.9), "S-001/w9": pick("g9", 0.6) }, questions)).toEqual([8]);
		expect(cutsFrom({ "S-001/w3": pick("g8", 0.4), "S-001/w9": pick("none", 0.9) }, questions)).toEqual([]);
	});

	it("cuts and highlights the item without changing its words", () => {
		const split = { words, cuts: [8] };
		expect(partsOf(split)).toEqual([
			"PASS if the memo states the notice period,",
			"the deadline and the governing law.",
		]);
		expect(highlight(split, 1)).toBe(
			"PASS if the memo states the notice period, ⟦the deadline and the governing law.⟧",
		);
		expect(partsOf(split).join(" ")).toBe(ITEM.text);
	});
});

describe("checks", () => {
	const split = { words, cuts: [8], accepted: 0.9 };

	it("asks about the whole item, anything missed and each part of an accepted split only", () => {
		expect(checkQuestions(ITEM, split).map((question) => question.id)).toEqual([
			"S-001/meets",
			"S-001/misses",
			"S-001/part1",
			"S-001/part2",
		]);
		expect(checkQuestions(ITEM, { ...split, accepted: 0.2 }).map((question) => question.id)).toEqual([
			"S-001/meets",
			"S-001/misses",
		]);
		expect(checkQuestions(ITEM, undefined)).toHaveLength(2);
	});

	it("reports the checks to the final decision", () => {
		const found: Record<string, Answer> = {
			"S-001/meets": { kind: "bool", probability: 0.93 },
			"S-001/part2": { kind: "bool", probability: 0.1 },
		};
		expect(checkLines(ITEM, split, found)).toEqual([
			"- Meets the whole item: 93% likely.",
			"- Misses or contradicts a requirement: 0% likely.",
			'- Meets part 1 "PASS if the memo states the notice period,": 0% likely.',
			'- Meets part 2 "the deadline and the governing law.": 10% likely.',
		]);
	});
});

describe("staged judge", () => {
	it("splits, checks and decides, records each stage, and splits an item once for every answer", async () => {
		const domain = createLegalJudge();
		const workspace = workspaceOf(legalCase({ items: [ITEM] }));
		const decider = fakeDecider(staged);
		const first = await run(domain, workspace, decider, { case: "a" });
		expect(first.answers).toEqual({ "S-001": { kind: "bool", probability: 0.8 } });
		const stages = first.trace.entries.flatMap((entry) => (entry.type === "asked" ? [entry.stage] : []));
		expect(stages).toEqual(["split S-001", "accept splits", "check", "decide"]);
		const decided = decider.requests.at(-1);
		expect(decided?.state).toMatchObject({
			stage: expect.stringContaining("Stage 4") as unknown,
			rules: expect.any(String) as unknown,
		});
		const final = decided?.questions[0];
		expect(final?.instructions).toContain('- Meets part 2 "the deadline and the governing law.": 20% likely.');
		const before = decider.requests.length;
		const second = await run(domain, workspace, decider, { case: "b" });
		expect(second.trace.entries.flatMap((entry) => (entry.type === "asked" ? [entry.stage] : []))).toEqual([
			"check",
			"decide",
		]);
		expect(decider.requests.length - before).toBe(3);
	});

	it("fails the case when a stage fails", async () => {
		const failing = fakeDecider((request) =>
			request.questions.some((question) => question.id.endsWith("/meets"))
				? { ok: false, failure: "provider", message: "down", usage }
				: staged(request),
		);
		const result = await run(createLegalJudge(), workspaceOf(legalCase({ items: [ITEM] })), failing, { case: "a" });
		expect(result).toMatchObject({ answers: null, error: "provider: down" });
	});
});

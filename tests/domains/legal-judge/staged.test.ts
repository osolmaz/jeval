import { describe, expect, it } from "vitest";
import { type Answer, type DecisionRequest, type DecisionResult, run, STOP_KEY } from "../../../src/core/index.ts";
import { createLegalJudge } from "../../../src/domains/legal-judge/index.ts";
import { requirementsOf } from "../../../src/domains/legal-judge/judge.ts";
import { gapsOf, highlight, partsOf, wordsOf } from "../../../src/domains/legal-judge/split.ts";
import { fakeDecider } from "../../helpers/fakes.ts";
import { legalCase, workspaceOf } from "../../helpers/cases.ts";

const ITEM = {
	id: "S-001",
	category: "substance",
	text: "PASS if the memo states the notice period, the deadline and the governing law.",
};
const words = wordsOf(ITEM.text);
const usage = { inputTokens: 1, milliseconds: 1 };

const choose = (question: { id: string; choices: Readonly<Record<string, string>> }): string => {
	if (question.id === "next") return STOP_KEY;
	if (question.id.startsWith("S-001/0/w")) return "n5";
	const notice = Object.entries(question.choices).find(([, text]) => text.includes("notice period is"))?.[0];
	return notice ?? "none";
};

/** Splits the item after "period,", points part 1 at the memo's sentence and part 2 at nothing, and answers checks. */
function staged(request: DecisionRequest): DecisionResult {
	const answers: Record<string, Answer> = {};
	for (const question of request.questions) {
		if (question.kind === "choice") {
			const choice = choose(question);
			answers[question.id] = { kind: "choice", choice, probabilities: { [choice]: 0.9 } };
		} else {
			const probability = question.id.endsWith("/misses") ? 0.2 : question.id.endsWith("/sentence") ? 0.9 : 0.7;
			answers[question.id] = { kind: "bool", probability };
		}
	}
	return { ok: true, answers, usage };
}

describe("splitting by pointing", () => {
	it("shows the item's word gaps, each quoting its neighbours, and cuts without changing a word", async () => {
		const gaps = (await gapsOf(ITEM, words).children?.()) ?? [];
		expect(gaps.map((gap) => gap.id).slice(0, 2)).toEqual(["S-001:3", "S-001:4"]);
		expect(gaps[5]?.title).toBe('Between "states the notice period," and "the deadline and the"');
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

	it("uses the parts of an accepted split, and the whole item otherwise", () => {
		const split = { words, cuts: [8], accepted: 0.9 };
		expect(requirementsOf(ITEM, split).map((requirement) => requirement.id)).toEqual(["S-001/part1", "S-001/part2"]);
		expect(requirementsOf(ITEM, { ...split, accepted: 0.3 })).toEqual([
			{ id: "S-001/whole", item: ITEM, highlighted: null, text: ITEM.text },
		]);
		expect(requirementsOf(ITEM, undefined)).toHaveLength(1);
	});
});

describe("staged judge", () => {
	it("splits, points to evidence, checks and decides, and splits an item once for every answer", async () => {
		const domain = createLegalJudge();
		const workspace = workspaceOf(legalCase({ items: [ITEM] }));
		const decider = fakeDecider(staged);
		const first = await run(domain, workspace, decider, { case: "a" });
		expect(first.answers).toEqual({ "S-001": { kind: "bool", probability: 0.7 } });
		const stages = (result: typeof first) =>
			result.trace.entries.flatMap((entry) => (entry.type === "asked" ? [entry.stage] : []));
		expect(stages(first)).toEqual(["split", "accept splits", "point 1", "check pointed", "check items", "decide"]);
		const final = decider.requests.at(-1)?.questions[0]?.instructions ?? "";
		expect(final).toContain(
			'- Part "PASS if the memo states the notice period,": the answer\'s sentence «The notice period is 30 days under Section 4.2.» meets it: 90% likely.',
		);
		expect(final).toContain(
			'- Part "the deadline and the governing law.": no sentence of the answer was found that meets it.',
		);
		expect(final).toContain("- Misses or contradicts a requirement: 20% likely.");
		const checked = decider.requests.find((request) =>
			request.questions.some((question) => question.id.endsWith("/sentence")),
		);
		expect(checked?.state).toMatchObject({
			stage: expect.stringContaining("Stage 4") as unknown,
			rules: expect.any(String) as unknown,
		});
		const second = await run(domain, workspace, decider, { case: "b" });
		expect(stages(second)).toEqual(["point 1", "check pointed", "check items", "decide"]);
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

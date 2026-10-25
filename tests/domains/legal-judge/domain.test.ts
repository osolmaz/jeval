import { describe, expect, it } from "vitest";
import { type Answer, run, STOP_KEY } from "../../../src/core/index.ts";
import { itemQuestions, itemVerdict } from "../../../src/domains/legal-judge/definition.ts";
import { DEFAULT_JUDGE, judgeOf, legalJudge, loadJudge } from "../../../src/domains/legal-judge/index.ts";
import { combine } from "../../../src/domains/legal-judge/judge.ts";
import { openAnswer } from "../../../src/domains/legal-judge/start.ts";
import { searchTerms, termsIn } from "../../../src/domains/legal-judge/terms.ts";
import { fitEvidence, view } from "../../../src/domains/legal-judge/view.ts";
import { LIMITS } from "../../../src/domains/legal-judge/workspace.ts";
import { answering, fakeDecider } from "../../helpers/fakes.ts";
import { file, legalCase, workspaceOf } from "../../helpers/cases.ts";

const judge = await loadJudge(DEFAULT_JUDGE);
const texts = judge.definition.texts;

describe("terms", () => {
	it("finds quoted text, amounts, durations, dates, clause references and names", () => {
		const text = `PASS if it quotes "notice period", 'the Tenant' and USD 2,500, gives 30 days, 1 March 2026 and Section 4.2(a), and names Atlas National Bank. The answer fails otherwise.`;
		expect(termsIn(text)).toEqual(
			expect.arrayContaining([
				"notice period",
				"the Tenant",
				"USD 2,500",
				"30 days",
				"1 March 2026",
				"Section 4.2(a)",
				"Atlas National Bank",
			]),
		);
		expect(termsIn("PASS if The Output is short.")).not.toContain("PASS");
	});

	it("keeps terms some file mentions, the documents' first, and adds the answer's figures", () => {
		const terms = searchTerms(
			legalCase({
				items: [
					{ id: "S-1", category: null, text: 'PASS if it says "Sign it" and "notice period" and "unknown term".' },
				],
			}),
		);
		expect(terms.map((term) => [term.term, term.inDocuments])).toEqual([
			["notice period", true],
			["30 days", true],
			["Section 4.2", true],
			["Sign it", false],
		]);
		expect(terms.find((term) => term.term === "30 days")?.items).toEqual([]);
	});
});

describe("openAnswer", () => {
	it("reads the answer's text, looks at its images and lists its Word formatting before the first choice", async () => {
		const answer = legalCase({
			files: [
				file("a1", "output/memo.docx", "answer", ["P1: Memo text."], {
					kind: "docx",
					formatting: "Tracked insertions: 0; tracked deletions: 0.",
				}),
				file("a2", "output/chart.png", "answer", [], {
					kind: "image",
					renders: [{ label: "image", path: "images/a2-1.png", mimeType: "image/png" }],
				}),
				file("a3", "output/broken.pdf", "answer", [], { error: "PDF error" }),
			],
		});
		const entries = await openAnswer(workspaceOf(answer));
		expect(entries.map((entry) => entry.key)).toEqual(["read:a1:0-0", "changes:a1", "look:a2:0", "unreadable:a3"]);
		expect(entries[3]?.observation.text).toBe("[the file could not be read: PDF error]");
	});

	it("stops reading the answer at its budget", async () => {
		const page = "word ".repeat(10_000);
		const long = legalCase({ files: [file("a1", "output/long.md", "answer", [page, page, page, page])] });
		const entries = await openAnswer(workspaceOf(long));
		expect(entries.length).toBeLessThan(4);
	});
});

describe("view", () => {
	it("shows the rubric, the files and the steps for a choice, and only the request and evidence for the answers", () => {
		const workspace = workspaceOf(legalCase());
		const log = [
			{
				action: "read",
				key: "read:d1:0-0",
				observation: { source: "documents/lease.pdf, page 1", text: "Section 4.2" },
			},
		];
		const chosen = view(texts, { workspace, log }, "choose", 50_000);
		expect(Object.keys(chosen.state)).toEqual([
			"process",
			"stage",
			"request",
			"rubric",
			"files",
			"steps_taken",
			"evidence",
		]);
		expect(chosen.state["files"]).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "documents/lease.pdf", read: "1 of 2 parts" })]),
		);
		expect(Object.keys(view(texts, { workspace, log }, "answer", 50_000).state)).toEqual(["request", "evidence"]);
	});

	it("cuts the longest evidence first to fit, and says so", () => {
		const evidence = [
			{ source: "long", text: "x".repeat(3000) },
			{ source: "short", text: "y".repeat(30) },
		];
		const fitted = fitEvidence(evidence, 200);
		expect(fitted.evidence[1]).toEqual(evidence[1]);
		expect(fitted.evidence[0]?.text).toMatch(/\[cut: \d+ characters left out to fit the window\]$/);
		expect(fitted.omitted).toEqual([expect.stringMatching(/^\d+ characters of long$/)]);
		expect(fitEvidence(evidence, 10_000).omitted).toEqual([]);
		expect(Math.ceil(JSON.stringify(fitted.evidence).length / LIMITS.charsPerToken)).toBeLessThanOrEqual(260);
	});
});

describe("legalJudge", () => {
	it("gathers evidence, then asks whether each item is met and whether anything is missed", async () => {
		const item = { id: "S-1", category: null, text: "PASS if x." };
		expect(itemQuestions(judge.definition, item).map((question) => question.instructions)).toEqual([
			"Rubric item S-1:\nPASS if x.\n\nDoes the submitted answer meet this item?",
			expect.stringMatching(/^Rubric item S-1:\nPASS if x\.\n\nCheck each requirement/) as unknown,
		]);
		expect(itemVerdict({ ...item, category: "form" })).toMatchObject({
			id: "S-1",
			instructions: "Rubric item S-1 (form):\nPASS if x.",
		});
		const domain = legalJudge(judge);
		expect(domain.version).toBe(`0.3.0 legal-judge@${judge.hash.slice(0, 12)}`);
		let calls = 0;
		const decider = fakeDecider(answering(0.9, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		const result = await run(domain, workspaceOf(legalCase()), decider, { case: "case-1" });
		expect(result.steps).toBe(2);
		expect(decider.requests[0]?.questions[0]?.instructions).toBe(`${texts.gather} ${texts.choose}`);
		const last = decider.requests.at(-1);
		expect(last?.questions.map((question) => question.id)).toEqual([
			"S-001/meets",
			"S-001/misses",
			"F-001/meets",
			"F-001/misses",
		]);
		expect(last?.state).toMatchObject({ process: texts.process, stage: texts.check, rules: texts.rules });
		// Every question answered 0.9: the answer meets each item, but also misses something, so both fail.
		expect(result.answers).toEqual({
			"S-001": { kind: "bool", probability: expect.closeTo(0.1) as unknown },
			"F-001": { kind: "bool", probability: expect.closeTo(0.1) as unknown },
		});
	});
});

describe("judge definitions", () => {
	const definition = judge.definition;

	it("are named by a hash of their content, not of their formatting", () => {
		const reordered = Object.fromEntries(Object.entries(definition).reverse());
		const reformatted = JSON.parse(JSON.stringify(reordered, null, 7)) as unknown;
		expect(judgeOf(reformatted).hash).toBe(judge.hash);
		expect(judge.hash).toMatch(/^[0-9a-f]{64}$/);
		const changed = { ...definition, texts: { ...definition.texts, rules: `${definition.texts.rules} More.` } };
		expect(judgeOf(changed).hash).not.toBe(judge.hash);
	});

	it("refuse unknown fields, a question without the item, and two questions with one id", () => {
		expect(() => judgeOf({ ...definition, extra: 1 })).toThrow();
		const [meets] = definition.questions;
		if (meets === undefined) throw new Error("the judge has no questions");
		expect(() => judgeOf({ ...definition, questions: [{ ...meets, instructions: "No item." }] })).toThrow();
		expect(() => judgeOf({ ...definition, questions: [meets, meets] })).toThrow("question ids must differ");
	});
});

describe("combine", () => {
	const item = { id: "S-1", category: null, text: "PASS if x." };
	const bool = (probability: number): Answer => ({ kind: "bool", probability });
	const definition = judge.definition;

	it("passes an item only when every question for it says yes and every question against it says no", () => {
		expect(combine(definition, item, { "S-1/meets": bool(0.9), "S-1/misses": bool(0.2) })).toEqual(bool(0.8));
		expect(combine(definition, item, { "S-1/meets": bool(0.9), "S-1/misses": bool(0.7) })).toEqual(
			bool(expect.closeTo(0.3) as unknown as number),
		);
		expect(combine(definition, item, { "S-1/meets": bool(0.4), "S-1/misses": bool(0.1) })).toEqual(bool(0.4));
		expect(combine(definition, item, {})).toEqual(bool(0));
	});
});

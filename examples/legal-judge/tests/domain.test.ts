import { describe, expect, it } from "vitest";
import { type Answer, PICK_ID, run, STOP_KEY } from "@osolmaz/switch";
import { answering, fakeDecider } from "@osolmaz/switch/testing";
import { itemQuestions, itemVerdict } from "../src/definition.ts";
import { DEFAULT_JUDGE, judgeOf, legalJudge, legalMachine, loadJudge } from "../src/index.ts";
import { combine } from "../src/judge.ts";
import { openAnswer } from "../src/start.ts";
import { SIZES } from "../src/state.ts";
import { searchTerms, termsIn } from "../src/terms.ts";
import { fitEvidence, view } from "../src/view.ts";
import { evidence, file, folderOf, legalCase, stateOf } from "./helpers/cases.ts";

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
	it("reads the answer's text, looks at its images and lists its Word formatting before the first pick", () => {
		const answer = legalCase({
			files: [
				file("a1", "output/memo.docx", "answer", ["P1: Memo text."], {
					format: "docx",
					formatting: "Tracked insertions: 0; tracked deletions: 0.",
				}),
				file("a2", "output/chart.png", "answer", [], {
					format: "image",
					renders: [{ label: "image", path: "images/a2-1.png", mimeType: "image/png" }],
				}),
				file("a3", "output/broken.pdf", "answer", [], { error: "PDF error" }),
			],
		});
		const { evidence: found } = openAnswer(answer);
		expect(found.map((entry) => entry.key)).toEqual(["read:a1:0-0", "changes:a1", "look:a2:0", "unreadable:a3"]);
		expect(found[2]).toMatchObject({ source: "output/chart.png", image: { path: "images/a2-1.png" } });
		expect(found[3]?.text).toBe("[the file could not be read: PDF error]");
	});

	it("stops reading the answer at its budget, and looks at no more images than the case may see", () => {
		const page = "word ".repeat(10_000);
		const long = legalCase({ files: [file("a1", "output/long.md", "answer", [page, page, page, page])] });
		expect(openAnswer(long).evidence.length).toBeLessThan(4);
		const render = { label: "image", path: "images/a1.png", mimeType: "image/png" };
		const many = Array.from({ length: SIZES.images + 2 }, () => render);
		const images = legalCase({
			files: [file("a1", "output/a.png", "answer", [], { format: "image", renders: many })],
		});
		expect(openAnswer(images).evidence).toHaveLength(SIZES.images);
	});
});

describe("view", () => {
	it("shows the rubric, the files and the steps for a pick, and only the request and evidence for the answers", async () => {
		const folder = folderOf(legalCase());
		const state = stateOf({ ...evidence("read:d1:0-0", "Section 4.2"), source: "documents/lease.pdf, page 1" });
		const picking = await view(texts, folder, state, "pick", 50_000, 3);
		expect(Object.keys(picking.decisionState)).toEqual([
			"process",
			"stage",
			"request",
			"rubric",
			"files",
			"steps_taken",
			"evidence",
		]);
		expect(picking.decisionState["files"]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "documents/lease.pdf", format: "pdf", read: "1 of 2 parts" }),
			]),
		);
		expect(picking.decisionState["evidence"]).toEqual([
			{ source: "documents/lease.pdf, page 1", text: "Section 4.2" },
		]);
		const answering = await view(texts, folder, state, "answer", 50_000, 3);
		expect(Object.keys(answering.decisionState)).toEqual(["request", "evidence"]);
	});

	it("loads the images that the evidence names from the case folder", async () => {
		const render = { label: "page 1 image", path: "images/d1-1.png", mimeType: "image/png" };
		const state = stateOf(evidence("read:a1:0-0"), evidence("look:d1:0", "[image]", { image: render }));
		const seen = await view(texts, folderOf(legalCase()), state, "answer", 50_000, 3);
		expect(seen.decisionImages).toEqual([
			{ label: "page 1 image", mimeType: "image/png", data: "data:images/d1-1.png" },
		]);
	});

	it("cuts the longest evidence first to fit, and says so in the text it cut", () => {
		const evidence = [
			{ source: "long", text: "x".repeat(3000) },
			{ source: "short", text: "y".repeat(30) },
		];
		const fitted = fitEvidence(evidence, 200, 3);
		expect(fitted[1]).toEqual(evidence[1]);
		expect(fitted[0]?.text).toMatch(/\[cut: \d+ characters left out to fit the window\]$/);
		expect(fitEvidence(evidence, 10_000, 3)).toEqual(evidence);
		expect(Math.ceil(JSON.stringify(fitted).length / 3)).toBeLessThanOrEqual(260);
	});
});

describe("legalJudge", () => {
	it("gathers evidence, then asks whether each item is met and whether anything is missed", async () => {
		const item = { id: "S-1", category: null, text: "PASS if x." };
		expect(itemQuestions(judge.definition, item).map(([id, question]) => [id, question.instructions])).toEqual([
			["S-1/meets", "Rubric item S-1:\nPASS if x.\n\nDoes the submitted answer meet this item?"],
			["S-1/misses", expect.stringMatching(/^Rubric item S-1:\nPASS if x\.\n\nCheck each requirement/) as unknown],
		]);
		expect(itemVerdict({ ...item, category: "form" })).toMatchObject({
			instructions: "Rubric item S-1 (form):\nPASS if x.",
			criteria: { true: "The item passes.", false: "The item fails." },
		});
		const domain = legalJudge(judge);
		expect(domain.version).toBe("0.5.0");
		let calls = 0;
		const decider = fakeDecider(answering(0.9, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		const result = await run(domain, legalMachine(judge.definition, folderOf(legalCase())), decider);
		expect(result.steps).toBe(2);
		expect(result.state.evidence.map((entry) => entry.key)).toEqual(["read:a1:0-0", "read:d1:0-1"]);
		expect(result.trace.entries.filter((entry) => entry.type === "stage")).toHaveLength(1);
		expect(decider.requests[0]?.decisionQuestions[PICK_ID]?.instructions).toBe(`${texts.gather} ${texts.choose}`);
		const last = decider.requests.at(-1);
		expect(Object.keys(last?.decisionQuestions ?? {})).toEqual([
			"S-001/meets",
			"S-001/misses",
			"F-001/meets",
			"F-001/misses",
		]);
		expect(last?.decisionState).toMatchObject({ process: texts.process, stage: texts.check, rules: texts.rules });
		// Every question answered 0.9: the answer meets each item, but also misses something, so both fail.
		expect(result.answers).toEqual({
			"S-001": { type: "bool", probability: expect.closeTo(0.1) as unknown },
			"F-001": { type: "bool", probability: expect.closeTo(0.1) as unknown },
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
	const bool = (probability: number): Answer => ({ type: "bool", probability });
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

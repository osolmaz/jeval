import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PICK_ID, replayOf, run } from "@osolmaz/switch";
import { answering, fakeDecider } from "@osolmaz/switch/testing";
import { itemQuestions } from "../src/definition.ts";
import { DEFAULT_JUDGE, judgeMachine, judgeOf, judgeOutcome, loadJudge, rubricJudge } from "../src/index.ts";
import { combine, verdictsFrom } from "../src/judge.ts";
import { openAnswer } from "../src/start.ts";
import { SIZES } from "../src/state.ts";
import { searchTerms, termsIn } from "../src/terms.ts";
import { fitEvidence, view } from "../src/view.ts";
import { evidence, file, folderOf, judgeCase, stateOf } from "./helpers/cases.ts";

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
			judgeCase({
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
		const answer = judgeCase({
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
		const long = judgeCase({ files: [file("a1", "output/long.md", "answer", [page, page, page, page])] });
		expect(openAnswer(long).evidence.length).toBeLessThan(4);
		const render = { label: "image", path: "images/a1.png", mimeType: "image/png" };
		const many = Array.from({ length: SIZES.images + 2 }, () => render);
		const images = judgeCase({
			files: [file("a1", "output/a.png", "answer", [], { format: "image", renders: many })],
		});
		expect(openAnswer(images).evidence).toHaveLength(SIZES.images);
	});
});

describe("view", () => {
	it("shows the rubric, the files and the steps while gathering, and the evidence with the rules for the checks", async () => {
		const folder = folderOf(judgeCase());
		const state = stateOf({ ...evidence("read:d1:0-0", "Section 4.2"), source: "documents/lease.pdf, page 1" });
		const picking = await view(texts, folder, state, false, 50_000, 3);
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
		const checking = await view(texts, folder, state, true, 50_000, 3);
		expect(Object.keys(checking.decisionState)).toEqual(["request", "evidence", "process", "stage", "rules"]);
		expect(checking.decisionState).toMatchObject({ stage: texts.check, rules: texts.rules });
	});

	it("loads the images that the evidence names from the case folder", async () => {
		const render = { label: "page 1 image", path: "images/d1-1.png", mimeType: "image/png" };
		const state = stateOf(evidence("read:a1:0-0"), evidence("look:d1:0", "[image]", { image: render }));
		const seen = await view(texts, folderOf(judgeCase()), state, true, 50_000, 3);
		expect(seen.decisionImages).toEqual([
			{ type: "image", label: "page 1 image", mimeType: "image/png", data: "data:images/d1-1.png" },
		]);
		const textOnly = await view(texts, folderOf(judgeCase()), stateOf(evidence("read:a1:0-0")), true, 50_000, 3);
		expect(textOnly).not.toHaveProperty("decisionImages");
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

describe("rubricJudge", () => {
	/** Picks the first choice `n` times, then stop, which is the last choice. */
	const gathersThenStops = (n: number) => {
		let calls = 0;
		return answering(0.9, (labels) => (calls++ < n ? (labels[0] ?? "o1") : (labels.at(-1) ?? "o1")));
	};

	it("gathers evidence, then asks whether each item is met and whether anything is missed, in one step", async () => {
		const item = { id: "S-1", category: null, text: "PASS if x." };
		expect(itemQuestions(judge.definition, item).map(([id, question]) => [id, question.instructions])).toEqual([
			["S-1/meets", "Rubric item S-1:\nPASS if x.\n\nDoes the submitted answer meet this item?"],
			["S-1/misses", expect.stringMatching(/^Rubric item S-1:\nPASS if x\.\n\nCheck each requirement/) as unknown],
		]);
		const domain = rubricJudge(judge);
		expect(domain).toMatchObject({ version: "0.6.0", limits: { windowShare: judge.definition.limits.windowShare } });
		const decider = fakeDecider(gathersThenStops(1));
		const result = await run(domain, judgeMachine(judge.definition, folderOf(judgeCase())), decider);
		// Two gathering steps, a read and stop, then the checks.
		expect(result).toMatchObject({ steps: 3, ended: "done" });
		expect(result.state).toMatchObject({ steps: 2, gathered: true });
		expect(result.state.evidence.map((entry) => entry.key)).toEqual(["read:a1:0-0", "read:d1:0-1"]);
		const pick = decider.requests[0]?.decisionQuestions[PICK_ID];
		expect(pick?.instructions).toBe(`${texts.gather} ${texts.choose}`);
		expect(pick?.type === "choice" ? Object.values(pick.criteria).at(-1) : undefined).toBe(texts.stop);
		const last = decider.requests.at(-1);
		expect(Object.keys(last?.decisionQuestions ?? {})).toEqual([
			"S-001/meets",
			"S-001/misses",
			"F-001/meets",
			"F-001/misses",
		]);
		expect(last?.decisionState).toMatchObject({ process: texts.process, stage: texts.check, rules: texts.rules });
		expect(result.state.checks).toEqual({
			"S-001/meets": 0.9,
			"S-001/misses": 0.9,
			"F-001/meets": 0.9,
			"F-001/misses": 0.9,
		});
		// Every question answered 0.9: the answer meets each item, but also misses something, so both fail.
		expect(judgeOutcome(judge.definition)(result)).toEqual({
			verdicts: { "S-001": expect.closeTo(0.1) as unknown, "F-001": expect.closeTo(0.1) as unknown },
		});
	});

	it("ends gathering at the judge's most steps, in the state, so a fork under a looser judge asks only the checks", async () => {
		const short = { ...judge.definition, limits: { ...judge.definition.limits, steps: 1 } };
		const decider = fakeDecider(gathersThenStops(5));
		const result = await run(rubricJudge(judge), judgeMachine(short, folderOf(judgeCase())), decider);
		expect(result).toMatchObject({ steps: 2, ended: "done" });
		expect(result.state).toMatchObject({ steps: 1, gathered: true });
		expect(Object.keys(decider.requests.at(-1)?.decisionQuestions ?? {})).toHaveLength(4);
		const again = fakeDecider(gathersThenStops(5));
		const replay = replayOf(result.trace.entries, { fork: 1 });
		const forked = await run(rubricJudge(judge), judgeMachine(judge.definition, folderOf(judgeCase())), again, {
			replay,
		});
		expect(forked).toMatchObject({ steps: 2, ended: "done" });
		expect(again.requests).toHaveLength(1);
		expect(Object.keys(again.requests[0]?.decisionQuestions ?? {})).toHaveLength(4);
	});

	it("asks the checks at once when nothing is left to gather but stop, and has no verdicts before the checks", async () => {
		const bare = judgeCase({
			files: [file("a1", "output/memo.md", "answer", ["Short."])],
			items: [{ id: "S-1", category: null, text: "PASS if it is short." }],
		});
		const decider = fakeDecider(gathersThenStops(5));
		const result = await run(rubricJudge(judge), judgeMachine(judge.definition, folderOf(bare)), decider);
		expect(result).toMatchObject({ steps: 1, ended: "done" });
		expect(decider.requests.map((request) => Object.keys(request.decisionQuestions))).toEqual([
			["S-1/meets", "S-1/misses"],
		]);
		const unjudged = judgeMachine(judge.definition, folderOf(judgeCase()));
		expect(judgeOutcome(judge.definition)({ state: await unjudged.initial() })).toEqual({ verdicts: null });
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
		expect(() => judgeOf({ ...definition, limits: { ...definition.limits, choices: 1 } })).toThrow();
	});

	it("come as a general default, which names no field of work, and the legal judges, with the same questions", async () => {
		expect(definition.name).toBe("general");
		expect(JSON.stringify(definition)).not.toMatch(/legal|law|contract/i);
		const judges = new URL("../judges/", import.meta.url);
		for (const name of ["legal", "legal-qualifiers"]) {
			const legal = await loadJudge(fileURLToPath(new URL(`${name}.json`, judges)));
			expect(legal.definition).toMatchObject({ name, domain: "rubric-judge", questions: definition.questions });
			expect(legal.definition.texts.process).toContain("a legal task");
		}
	});
});

describe("combine", () => {
	const definition = judge.definition;

	it("passes an item only when every question for it says yes and every question against it says no", () => {
		expect(combine(definition, "S-1", { "S-1/meets": 0.9, "S-1/misses": 0.2 })).toBeCloseTo(0.8);
		expect(combine(definition, "S-1", { "S-1/meets": 0.9, "S-1/misses": 0.7 })).toBeCloseTo(0.3);
		expect(combine(definition, "S-1", { "S-1/meets": 0.4, "S-1/misses": 0.1 })).toBe(0.4);
		expect(combine(definition, "S-1", {})).toBe(0);
	});

	it("gives every item's verdict from the checks' answers", () => {
		const checks = { "S-1/meets": 0.9, "S-1/misses": 0.2, "F/2/meets": 0.4, "F/2/misses": 0.1 };
		const verdicts = verdictsFrom(definition, checks);
		expect(Object.keys(verdicts)).toEqual(["S-1", "F/2"]);
		expect(verdicts["S-1"]).toBeCloseTo(0.8);
		expect(verdicts["F/2"]).toBe(0.4);
	});
});

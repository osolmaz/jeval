import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Answer, parseRequests, parseTrace, PICK_ID, STOP_KEY } from "@osolmaz/switch";
import { replayCase, resultSchema, RunMismatchError, runCases, runRecordSchema } from "@osolmaz/switch/cli";
import { answering, failing, fakeDecider, type Policy } from "@osolmaz/switch/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_JUDGE } from "../src/index.ts";
import { ingestCase } from "../src/ingest/ingest.ts";
import { compareRuns, loadLabelledSet, scoreResults } from "../src/score/scores.ts";
import { rubricJudgeDomain, rubricJudgeSetup } from "../src/setup.ts";

let folder = "";
const rubricJudge = await rubricJudgeSetup(DEFAULT_JUDGE);
const ingest = (input: string, output: string, id: string) => ingestCase(input, output, { id });

/** `policy`, but every "misses" question gets `probability`: a judge that finds nothing missing, by default. */
function missingNothing(policy: Policy, probability = 0.1): Policy {
	return (request, call) => {
		const result = policy(request, call);
		if (result.stopReason !== "stop") return result;
		const answers: Record<string, Answer> = { ...result.decisionAnswers };
		for (const id of Object.keys(answers)) if (id.endsWith("/misses")) answers[id] = { type: "bool", probability };
		return { ...result, decisionAnswers: answers };
	};
}

async function inputFolder(name: string): Promise<string> {
	const input = join(folder, "inputs", name);
	await mkdir(join(input, "answer"), { recursive: true });
	await writeFile(join(input, "request.md"), "Draft a clause.");
	await writeFile(
		join(input, "rubric.json"),
		JSON.stringify({ items: [{ id: "S-1", category: "substance", text: "PASS if it is a clause." }] }),
	);
	await writeFile(join(input, "answer", "clause.md"), "The Tenant pays rent of USD 2,500 under Section 4.");
	return input;
}

/** A set file over `ids`, with a labels file in which every case has `labels`' verdict for item S-1. */
async function setOf(ids: readonly string[], labels: Readonly<Record<string, boolean>>): Promise<string> {
	await writeFile(
		join(folder, "labels.jsonl"),
		Object.entries(labels)
			.map(([id, pass]) => JSON.stringify({ id, items: [{ id: "S-1", pass }] }))
			.join("\n"),
	);
	const file = join(folder, "set.json");
	await writeFile(file, JSON.stringify({ name: "s", cases: "cases", labels: "labels.jsonl", ids }));
	return file;
}

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "rubric-judge-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe("the rubric-judge harness", () => {
	it("sets the domain up with the judge file of its own --judge flag, or with its default judge", async () => {
		expect((await rubricJudgeSetup(undefined)).definition).toEqual(rubricJudge.definition);
		expect(rubricJudgeDomain.flags?.map((flag) => flag.flag)).toEqual(["--judge <file>"]);
		const strict = join(folder, "strict.json");
		const definition = JSON.parse(await readFile(DEFAULT_JUDGE, "utf8")) as { name: string };
		await writeFile(strict, JSON.stringify({ ...definition, name: "strict" }));
		expect((await rubricJudgeDomain.setup({ judge: strict })).definition.name).toBe("strict");
		expect((await rubricJudgeDomain.setup({})).definition).toEqual(rubricJudge.definition);
	});

	it("ingests and runs cases, writes results and traces, skips done cases, replays a trace and scores the results", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		await ingest(await inputFolder("c2"), join(folder, "cases", "c2"), "c2");
		const lines: string[] = [];
		const options = {
			out: join(folder, "out"),
			concurrency: 2,
			progress: (line: string) => lines.push(line),
			set: { name: "s", file: "set.json" },
		};
		const decider = fakeDecider(missingNothing(answering(0.8, () => STOP_KEY)));
		const cases = [join(folder, "cases", "c1"), join(folder, "cases", "c2"), join(folder, "cases", "missing")];
		await runCases(rubricJudge, cases, decider, options);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(folder, "out", "run.json"), "utf8")));
		expect(run).toMatchObject({
			domain: "rubric-judge",
			version: "0.5.0",
			definition: { name: "general", hash: rubricJudge.definition.hash, content: { domain: "rubric-judge" } },
			model: "fake/decider",
			limits: { steps: 8, choices: 30, windowShare: 0.9 },
			set: { name: "s", file: "set.json" },
			totals: { cases: 3, failed: 1, requests: 4 },
		});
		const result = resultSchema.parse(
			JSON.parse(await readFile(join(folder, "out", "cases", "c1", "result.json"), "utf8")),
		);
		expect(result).toMatchObject({
			case: "c1",
			domain: "rubric-judge",
			model: "fake/decider",
			steps: 1,
			ended: "stop",
			error: null,
		});
		const requests = parseRequests(await readFile(join(folder, "out", "cases", "c1", "requests.jsonl"), "utf8"));
		expect(requests.map((recorded) => Object.keys(recorded.request.decisionQuestions))).toEqual([
			[PICK_ID],
			["S-1/meets", "S-1/misses"],
		]);
		// The check stage reads the view for the answers, with the process, the checking stage and the rules.
		expect(Object.keys(requests[1]?.request.decisionState ?? {})).toEqual([
			"request",
			"evidence",
			"process",
			"stage",
			"rules",
		]);
		expect(lines).toEqual(
			expect.arrayContaining(["c1: stop", "c2: stop", expect.stringMatching(/^missing: - \| ERROR .*ENOENT/)]),
		);

		await runCases(rubricJudge, [join(folder, "cases", "c1")], decider, options);
		expect(lines).toContain("c1: already done");

		const variant = join(folder, "variant.json");
		const definition = JSON.parse(await readFile(DEFAULT_JUDGE, "utf8")) as { limits: { steps: number } };
		await writeFile(variant, JSON.stringify({ ...definition, limits: { ...definition.limits, steps: 2 } }));
		await expect(runCases(await rubricJudgeSetup(variant), [], decider, options)).rejects.toThrow(RunMismatchError);

		const replayed = await replayCase(
			rubricJudge,
			join(folder, "cases", "c1"),
			join(folder, "out", "cases", "c1", "trace.jsonl"),
		);
		expect(replayed.answers).toEqual(result.answers);

		const set = await loadLabelledSet(await setOf(["c1", "c3"], { c1: true, c3: false }));
		expect(set.folders).toEqual([join(folder, "cases", "c1"), join(folder, "cases", "c3")]);
		expect(set.labels).toBe(join(folder, "labels.jsonl"));
		const scored = await scoreResults(join(folder, "out"), set);
		expect(scored.report).toMatchObject({
			answers: 2,
			invalid: ["c3"],
			itemAgreementOverScheduled: 0.5,
			byCategory: { substance: 1 },
		});
		expect(scored.text).toContain("Invalid: c3");
		await writeFile(join(folder, "set.json"), JSON.stringify({ name: "s", cases: "cases", ids: ["c1"] }));
		await expect(loadLabelledSet(join(folder, "set.json"))).rejects.toThrow();
	});

	it("answers a run's cases again over its steps, and compares the two runs on the cases both answered", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		await ingest(await inputFolder("c2"), join(folder, "cases", "c2"), "c2");
		const cases = [join(folder, "cases", "c1"), join(folder, "cases", "c2")];
		const options = { concurrency: 2, progress: () => undefined };
		let calls = 0;
		const first = fakeDecider(
			missingNothing(answering(0.8, (labels) => (calls++ % 2 === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY))),
		);
		await runCases(rubricJudge, cases, first, { ...options, out: join(folder, "first") });

		// A stricter judge, whose stop text differs too: the steps are repeated by their keys, not their texts.
		const strict = join(folder, "strict.json");
		const definition = JSON.parse(await readFile(DEFAULT_JUDGE, "utf8")) as {
			name: string;
			texts: Record<string, string>;
		};
		await writeFile(
			strict,
			JSON.stringify({ ...definition, name: "strict", texts: { ...definition.texts, stop: "Stop: enough." } }),
		);
		const second = fakeDecider(answering(0.3, () => STOP_KEY));
		const out = join(folder, "second");
		await runCases(await rubricJudgeSetup(strict), cases, second, {
			...options,
			out,
			stateFrom: join(folder, "first"),
		});

		// Only the questions went to the model: the picks and states were repeated from the first run.
		expect(second.requests.map((request) => Object.keys(request.decisionQuestions)[0])).toEqual([
			"S-1/meets",
			"S-1/meets",
		]);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(out, "run.json"), "utf8")));
		expect(run).toMatchObject({
			definition: { name: "strict" },
			stateFrom: join(folder, "first"),
			totals: { requests: 2 },
		});
		const states = async (name: string) =>
			parseTrace(await readFile(join(folder, name, "cases", "c1", "trace.jsonl"), "utf8")).flatMap((entry) =>
				entry.type === "state" ? [entry.state] : [],
			);
		expect(await states("second")).toEqual(await states("first"));
		expect((await states("first")).length).toBeGreaterThan(1);

		const set = await loadLabelledSet(await setOf(["c1", "c2", "c3"], { c1: true, c2: true, c3: true }));
		const compared = await compareRuns([join(folder, "first"), out], set);
		expect(
			compared.runs.map((entry) => [entry.definition.split("@")[0], entry.report.itemMetrics?.accuracy]),
		).toEqual([
			["general", 1],
			["strict", 0],
		]);
		expect(compared.text).toMatch(/^2 cases that every run answered/);
		expect(compared.text).toContain(`state of ${join(folder, "first")}`);
	});

	it("records a failed case's error", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		const lines: string[] = [];
		const broken = fakeDecider((request, call) =>
			PICK_ID in request.decisionQuestions ? answering(0.5, () => STOP_KEY)(request, call) : failing("down"),
		);
		await runCases(rubricJudge, [join(folder, "cases", "c1")], broken, {
			out: join(folder, "out"),
			concurrency: 1,
			progress: (line) => lines.push(line),
		});
		expect(lines).toEqual(["c1: stop | ERROR down"]);
	});
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inPool, replayCase, RunMismatchError, runCases } from "../../src/cli/commands.ts";
import { resultSchema, runRecordSchema } from "../../src/cli/runs.ts";
import { compareRuns, scoreResults } from "../../src/cli/scores.ts";
import { loadSet } from "../../src/cli/sets.ts";
import { domainNamed, INGESTERS } from "../../src/cli/domains.ts";
import { DEFAULT_LIMITS, parseTrace, STOP_KEY } from "../../src/core/index.ts";
import { DEFAULT_JUDGE } from "../../src/domains/legal-judge/index.ts";
import { answering, fakeDecider, missingNothing } from "../helpers/fakes.ts";

let folder = "";
const legalJudge = await domainNamed("legal-judge", DEFAULT_JUDGE);
const found = INGESTERS["legal-judge"];
if (found === undefined) throw new Error("the legal-judge domain is missing");
const ingest = found;

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

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe("inPool", () => {
	it("runs every item and never more than the limit at once", async () => {
		let running = 0;
		let most = 0;
		const done: number[] = [];
		await inPool([1, 2, 3, 4, 5], 2, async (item) => {
			running += 1;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 1));
			done.push(item);
			running -= 1;
		});
		expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
		expect(most).toBe(2);
		await inPool([], 3, () => Promise.reject(new Error("never")));
	});
});

describe("commands", () => {
	it("ingests and runs cases, writes results and traces, skips done cases, replays a trace and scores the results", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		await ingest(await inputFolder("c2"), join(folder, "cases", "c2"), "c2");
		const lines: string[] = [];
		const options = {
			out: join(folder, "out"),
			concurrency: 2,
			log: (line: string) => lines.push(line),
			set: { name: "s", file: "set.json" },
		};
		const decider = fakeDecider(missingNothing(answering(0.8, () => STOP_KEY)));
		const cases = [join(folder, "cases", "c1"), join(folder, "cases", "c2"), join(folder, "cases", "missing")];
		await runCases(legalJudge, cases, decider, options);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(folder, "out", "run.json"), "utf8")));
		expect(run).toMatchObject({
			domain: "legal-judge",
			judge: { name: "legal-judge", hash: legalJudge.judge.hash },
			model: "fake/decider",
			limits: DEFAULT_LIMITS,
			switch: { version: expect.any(String) as unknown },
			finished: expect.stringMatching(/^\d{4}-/) as unknown,
			set: { name: "s", file: "set.json" },
			totals: { cases: 2, failed: 0, calls: 4 },
		});
		const result = resultSchema.parse(
			JSON.parse(await readFile(join(folder, "out", "cases", "c1", "result.json"), "utf8")),
		);
		expect(result).toMatchObject({
			case: "c1",
			domain: "legal-judge",
			model: "fake/decider",
			steps: 1,
			error: null,
			categories: { "S-1": "substance" },
		});
		const requests = (await readFile(join(folder, "out", "cases", "c1", "requests.jsonl"), "utf8"))
			.split("\n")
			.filter(Boolean)
			.map(
				(line) => JSON.parse(line) as { request: { state: Record<string, unknown>; questions: { id: string }[] } },
			);
		expect(requests.map((exchange) => exchange.request.questions.map((question) => question.id))).toEqual([
			["next"],
			["S-1/meets", "S-1/misses"],
		]);
		expect(requests[1]?.request.state).toMatchObject({ rules: expect.any(String) as unknown });
		const trace = await readFile(join(folder, "out", "cases", "c1", "trace.jsonl"), "utf8");
		const ids = parseTrace(trace).map((entry) => entry.id);
		expect(ids.length).toBeGreaterThan(3);
		expect(ids).toEqual(ids.map((_, index) => index));
		expect(lines).toEqual(
			expect.arrayContaining(["c1: stop", "c2: stop", expect.stringMatching(/^missing: FAILED/)]),
		);

		await runCases(legalJudge, [join(folder, "cases", "c1")], decider, options);
		expect(lines).toContain("c1: already done");

		const variant = join(folder, "variant.json");
		const definition = JSON.parse(await readFile(DEFAULT_JUDGE, "utf8")) as { limits: { steps: number } };
		await writeFile(variant, JSON.stringify({ ...definition, limits: { ...definition.limits, steps: 2 } }));
		await expect(runCases(await domainNamed("legal-judge", variant), [], decider, options)).rejects.toThrow(
			RunMismatchError,
		);

		const replayed = await replayCase(
			legalJudge,
			join(folder, "cases", "c1"),
			join(folder, "out", "cases", "c1", "trace.jsonl"),
		);
		expect(replayed.result.answers).toEqual(result.answers);

		const labels = join(folder, "labels.jsonl");
		await writeFile(
			labels,
			`${JSON.stringify({ id: "c1", items: [{ id: "S-1", pass: true }] })}\n${JSON.stringify({ id: "c3", items: [{ id: "S-1", pass: false }] })}\n`,
		);
		const setFile = join(folder, "set.json");
		await writeFile(
			setFile,
			JSON.stringify({ name: "s", cases: "cases", labels: "labels.jsonl", ids: ["c1", "c3"] }),
		);
		const set = await loadSet(setFile);
		expect(set.folders).toEqual([join(folder, "cases", "c1"), join(folder, "cases", "c3")]);
		const scored = await scoreResults(join(folder, "out"), set);
		expect(scored.report).toMatchObject({ answers: 2, invalid: ["c3"], itemAgreementOverScheduled: 0.5 });
		expect(scored.text).toContain("Invalid: c3");
		await writeFile(setFile, JSON.stringify({ name: "s", cases: "cases", labels: "labels.jsonl", ids: [] }));
		await expect(loadSet(setFile)).rejects.toThrow();
	});

	it("judges a run's cases again over its evidence, and compares the two runs on the cases both answered", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		await ingest(await inputFolder("c2"), join(folder, "cases", "c2"), "c2");
		const cases = [join(folder, "cases", "c1"), join(folder, "cases", "c2")];
		const options = { concurrency: 2, log: () => undefined };
		let calls = 0;
		const first = fakeDecider(
			missingNothing(answering(0.8, (labels) => (calls++ % 2 === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY))),
		);
		await runCases(legalJudge, cases, first, { ...options, out: join(folder, "first") });

		const strict = join(folder, "strict.json");
		const definition = JSON.parse(await readFile(DEFAULT_JUDGE, "utf8")) as { name: string };
		await writeFile(strict, JSON.stringify({ ...definition, name: "strict" }));
		const second = fakeDecider(answering(0.3, () => STOP_KEY));
		const out = join(folder, "second");
		await runCases(await domainNamed("legal-judge", strict), cases, second, {
			...options,
			out,
			evidenceFrom: join(folder, "first"),
		});

		// Only the judging went to the model: the steps were repeated from the first run.
		expect(second.requests.map((request) => request.questions[0]?.id)).toEqual(["S-1/meets", "S-1/meets"]);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(out, "run.json"), "utf8")));
		expect(run).toMatchObject({
			judge: { name: "strict" },
			evidenceFrom: join(folder, "first"),
			totals: { calls: 2 },
		});
		const observations = async (run: string) =>
			parseTrace(await readFile(join(folder, run, "cases", "c1", "trace.jsonl"), "utf8"))
				.filter((entry) => entry.type === "observation")
				.map((entry) => entry.key);
		expect(await observations("second")).toEqual(await observations("first"));
		expect((await observations("first")).length).toBeGreaterThan(1);

		const labels = join(folder, "labels.jsonl");
		await writeFile(
			labels,
			["c1", "c2", "c3"].map((id) => JSON.stringify({ id, items: [{ id: "S-1", pass: true }] })).join("\n"),
		);
		const setFile = join(folder, "set.json");
		await writeFile(
			setFile,
			JSON.stringify({ name: "s", cases: "cases", labels: "labels.jsonl", ids: ["c1", "c2", "c3"] }),
		);
		const compared = await compareRuns([join(folder, "first"), out], await loadSet(setFile));
		expect(compared.runs.map((entry) => [entry.judge.split("@")[0], entry.report.itemMetrics?.accuracy])).toEqual([
			["legal-judge", 1],
			["strict", 0],
		]);
		expect(compared.text).toMatch(/^2 cases that every run answered/);
		expect(compared.text).toContain(`evidence of ${join(folder, "first")}`);
	});

	it("records a failed case's error", async () => {
		await ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		const lines: string[] = [];
		const broken = fakeDecider((request, call) =>
			request.questions[0]?.kind === "choice"
				? answering(0.5, () => STOP_KEY)(request, call)
				: { ok: false, failure: "provider", message: "down", usage: { inputTokens: null, milliseconds: 0 } },
		);
		await runCases(legalJudge, [join(folder, "cases", "c1")], broken, {
			out: join(folder, "out"),
			concurrency: 1,
			log: (line) => lines.push(line),
		});
		expect(lines).toEqual(["c1: stop | ERROR provider: down"]);
	});
});

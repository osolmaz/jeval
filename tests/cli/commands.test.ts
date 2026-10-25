import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	inPool,
	replayCase,
	resultSchema,
	RunMismatchError,
	runCases,
	runRecordSchema,
	scoreResults,
} from "../../src/cli/commands.ts";
import { DOMAINS, type DomainEntry } from "../../src/cli/domains.ts";
import { DEFAULT_LIMITS, parseTrace, STOP_KEY } from "../../src/core/index.ts";
import { answering, fakeDecider, missingNothing } from "../helpers/fakes.ts";

let folder = "";
const found = DOMAINS["legal-judge"];
if (found === undefined) throw new Error("the legal-judge domain is missing");
const legalJudge: DomainEntry = found;

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
	folder = await mkdtemp(join(tmpdir(), "jeval-cli-"));
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
		await legalJudge.ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		await legalJudge.ingest(await inputFolder("c2"), join(folder, "cases", "c2"), "c2");
		const lines: string[] = [];
		const options = {
			out: join(folder, "out"),
			concurrency: 2,
			limits: DEFAULT_LIMITS,
			log: (line: string) => lines.push(line),
		};
		const decider = fakeDecider(missingNothing(answering(0.8, () => STOP_KEY)));
		const cases = [join(folder, "cases", "c1"), join(folder, "cases", "c2"), join(folder, "cases", "missing")];
		await runCases(legalJudge, cases, decider, options);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(folder, "out", "run.json"), "utf8")));
		expect(run).toMatchObject({
			domain: "legal-judge",
			model: "fake/decider",
			limits: DEFAULT_LIMITS,
			jeval: { version: expect.any(String) as unknown },
			finished: expect.stringMatching(/^\d{4}-/) as unknown,
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

		await expect(
			runCases(legalJudge, [], decider, { ...options, limits: { ...DEFAULT_LIMITS, steps: 2 } }),
		).rejects.toThrow(RunMismatchError);

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
		const all = await scoreResults(join(folder, "out"), labels);
		expect(all.report).toMatchObject({ answers: 1, itemAgreementOverScheduled: 1 });
		const scheduled = join(folder, "cases.txt");
		await writeFile(scheduled, "c1\nc3\n");
		const listed = await scoreResults(join(folder, "out"), labels, scheduled);
		expect(listed.report).toMatchObject({ answers: 2, invalid: ["c3"] });
		expect(listed.text).toContain("Invalid: c3");
	});

	it("records a failed case's error", async () => {
		await legalJudge.ingest(await inputFolder("c1"), join(folder, "cases", "c1"), "c1");
		const lines: string[] = [];
		const broken = fakeDecider((request, call) =>
			request.questions[0]?.kind === "choice"
				? answering(0.5, () => STOP_KEY)(request, call)
				: { ok: false, failure: "provider", message: "down", usage: { inputTokens: null, milliseconds: 0 } },
		);
		await runCases(legalJudge, [join(folder, "cases", "c1")], broken, {
			out: join(folder, "out"),
			concurrency: 1,
			limits: DEFAULT_LIMITS,
			log: (line) => lines.push(line),
		});
		expect(lines).toEqual(["c1: stop | ERROR provider: down"]);
	});
});

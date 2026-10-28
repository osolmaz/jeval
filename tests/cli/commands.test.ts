import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inPool, replayCase, RunMismatchError, runCases } from "../../src/cli/commands.ts";
import { resultSchema, runRecordSchema } from "../../src/cli/runs.ts";
import { loadSet } from "../../src/cli/sets.ts";
import { DEFAULT_LIMITS, parseTrace, STOP_KEY } from "../../src/core/index.ts";
import { factsFolder, factsSetup } from "../helpers/facts.ts";
import { answering, fakeDecider } from "../helpers/fakes.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

const caseFile = (run: string, id: string, name: string) => join(folder, run, "cases", id, name);

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

describe("runCases", () => {
	it("writes a run folder: run.json, and each case's result, trace and requests; skips done cases; replays a trace", async () => {
		const domain = await factsSetup(undefined);
		const cases = [
			await factsFolder(folder, "c1"),
			await factsFolder(folder, "c2"),
			join(folder, "cases", "missing"),
		];
		const lines: string[] = [];
		const options = {
			out: join(folder, "out"),
			concurrency: 2,
			log: (line: string) => lines.push(line),
			set: { name: "s", file: "set.json" },
		};
		const decider = fakeDecider(answering(0.8, () => STOP_KEY));
		await runCases(domain, cases, decider, options);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(folder, "out", "run.json"), "utf8")));
		expect(run).toMatchObject({
			domain: "facts",
			version: "1.0.0",
			definition: { name: "facts", hash: domain.definition.hash, content: { stop: "Stop" } },
			model: "fake/decider",
			limits: DEFAULT_LIMITS,
			switch: { version: expect.any(String) as unknown },
			finished: expect.stringMatching(/^\d{4}-/) as unknown,
			set: { name: "s", file: "set.json" },
			stateFrom: null,
			totals: { cases: 2, failed: 0, calls: 4 },
		});
		const result = resultSchema.parse(JSON.parse(await readFile(caseFile("out", "c1", "result.json"), "utf8")));
		expect(result).toEqual({
			case: "c1",
			domain: "facts",
			version: "1.0.0",
			model: "fake/decider",
			steps: 1,
			error: null,
			answers: { a: { type: "bool", probability: 0.8 }, b: { type: "bool", probability: 0.8 } },
			outcome: { result: "answered", reason: "stop", looked: 0 },
		});
		const requests = (await readFile(caseFile("out", "c1", "requests.jsonl"), "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { request: { questions: { id: string }[] } });
		expect(requests.map((exchange) => exchange.request.questions.map((question) => question.id))).toEqual([
			["next"],
			["a", "b"],
		]);
		const ids = parseTrace(await readFile(caseFile("out", "c1", "trace.jsonl"), "utf8")).map((entry) => entry.id);
		expect(ids).toEqual(ids.map((_, index) => index));
		expect(lines).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^c1: 1 steps, \{"result":"answered"/),
				expect.stringMatching(/^missing: FAILED/),
			]),
		);

		await runCases(domain, [cases[0] ?? ""], decider, options);
		expect(lines).toContain("c1: already done");
		const other = { ...fakeDecider(answering(0.8, () => STOP_KEY)), model: "fake/other" };
		await expect(runCases(domain, [], other, options)).rejects.toThrow(RunMismatchError);

		const replayed = await replayCase(domain, cases[0] ?? "", caseFile("out", "c1", "trace.jsonl"));
		expect(replayed.result.answers).toEqual(result.answers);
	});

	it("answers a run's cases again over the states of another run, and records that run", async () => {
		const domain = await factsSetup(undefined);
		const cases = [await factsFolder(folder, "c1")];
		const options = { concurrency: 1, log: () => undefined };
		let calls = 0;
		const first = fakeDecider(answering(0.8, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		await runCases(domain, cases, first, { ...options, out: join(folder, "first") });
		const second = fakeDecider(answering(0.3, () => STOP_KEY));
		await runCases(domain, cases, second, {
			...options,
			out: join(folder, "second"),
			stateFrom: join(folder, "first"),
		});

		// Only the questions went to the model: the picks and states were repeated from the first run.
		expect(second.requests.map((request) => request.questions[0]?.id)).toEqual(["a"]);
		const run = runRecordSchema.parse(JSON.parse(await readFile(join(folder, "second", "run.json"), "utf8")));
		expect(run).toMatchObject({ stateFrom: join(folder, "first"), totals: { calls: 1 } });
		const states = async (name: string) =>
			parseTrace(await readFile(caseFile(name, "c1", "trace.jsonl"), "utf8")).flatMap((entry) =>
				entry.type === "state" ? [entry.state] : [],
			);
		expect(await states("second")).toEqual(await states("first"));
		expect((await states("first")).at(-1)).toEqual({ looked: ["a"], found: ["fact a"] });
	});

	it("records a failed case's error", async () => {
		const lines: string[] = [];
		const broken = fakeDecider((request, call) =>
			request.questions[0]?.type === "choice"
				? answering(0.5, () => STOP_KEY)(request, call)
				: { ok: false, failure: "provider", message: "down", usage: { inputTokens: null, milliseconds: 0 } },
		);
		await runCases(await factsSetup(undefined), [await factsFolder(folder, "c1")], broken, {
			out: join(folder, "out"),
			concurrency: 1,
			log: (line) => lines.push(line),
		});
		expect(lines).toEqual([expect.stringMatching(/^c1: 1 steps, .* \| ERROR provider: down$/)]);
	});
});

describe("eval sets", () => {
	it("give their scheduled case folders, and keep the fields that a harness adds", async () => {
		const setFile = join(folder, "set.json");
		await writeFile(
			setFile,
			JSON.stringify({ name: "s", cases: "cases", labels: "labels.jsonl", ids: ["c1", "c3"] }),
		);
		const set = await loadSet(setFile);
		expect(set).toEqual({
			name: "s",
			file: setFile,
			folders: [join(folder, "cases", "c1"), join(folder, "cases", "c3")],
			ids: new Set(["c1", "c3"]),
		});
		await writeFile(setFile, JSON.stringify({ name: "s", cases: "cases", ids: [] }));
		await expect(loadSet(setFile)).rejects.toThrow();
	});
});

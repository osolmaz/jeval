import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inPool, replayCase, RunMismatchError, runCases } from "../../src/cli/commands.ts";
import { readResult, runRecordSchema } from "../../src/cli/runs.ts";
import { loadSet } from "../../src/cli/sets.ts";
import { parseRequests, parseTrace, PICK_ID, type Runner, runnerOf, STOP_KEY } from "../../src/core/index.ts";
import { factsFolder, factsSetup } from "../helpers/facts.ts";
import { answering, FACTS, factsMachine, failing, fakeDecider, type Policy } from "../helpers/fakes.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

const caseFile = (run: string, id: string, name: string) => join(folder, run, "cases", id, name);
const runRecord = async (run: string) =>
	runRecordSchema.parse(JSON.parse(await readFile(join(folder, run, "run.json"), "utf8")));
const traceOf = async (run: string, id: string) => parseTrace(await readFile(caseFile(run, id, "trace.jsonl"), "utf8"));
const quiet = { concurrency: 1, log: () => undefined };
/** Picks the first choice `n` times, then stops. */
const picking = (n: number, probability = 0.8): Policy => {
	let calls = 0;
	return answering(probability, (labels) => (calls++ < n ? (labels[0] ?? STOP_KEY) : STOP_KEY));
};

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
	it("writes a run folder: run.json with its totals, and each case's result, trace and requests", async () => {
		const domain = await factsSetup();
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
		expect(await runRecord("out")).toMatchObject({
			domain: "facts",
			version: "1.0.0",
			definition: {
				name: "facts",
				hash: domain.definition.hash,
				content: { stop: "Stop", instructions: FACTS.instructions, limits: FACTS.limits },
			},
			model: "fake/decider",
			limits: FACTS.limits,
			switch: { version: expect.any(String) as unknown },
			finished: expect.stringMatching(/^\d{4}-/) as unknown,
			set: { name: "s", file: "set.json" },
			stateFrom: null,
			replay: null,
			totals: { cases: 2, failed: 0, calls: 4, usage: { input: 40, totalTokens: 40, cost: { total: 0.004 } } },
		});
		expect(await readResult(join(folder, "out"), "c1")).toEqual({
			case: "c1",
			domain: "facts",
			version: "1.0.0",
			model: "fake/decider",
			steps: 1,
			ended: "stop",
			error: null,
			answers: { a: { type: "bool", probability: 0.8 }, b: { type: "bool", probability: 0.8 } },
			outcome: { result: "answered", reason: "stop", looked: 0 },
		});
		const requests = parseRequests(await readFile(caseFile("out", "c1", "requests.jsonl"), "utf8"));
		expect(requests.map((recorded) => Object.keys(recorded.request.decisionQuestions))).toEqual([
			[PICK_ID],
			["a", "b"],
		]);
		expect(requests[0]?.result).toMatchObject({ stopReason: "stop", decisionUsage: { input: 10 } });
		expect(lines).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^c1: 1 steps, \{"result":"answered"/),
				expect.stringMatching(/^missing: FAILED/),
			]),
		);
	});

	it("goes on with a stopped run, and refuses a folder of another model or another definition", async () => {
		const domain = await factsSetup();
		const cases = [await factsFolder(folder, "c1")];
		const lines: string[] = [];
		const options = { out: join(folder, "out"), concurrency: 1, log: (line: string) => lines.push(line) };
		await runCases(domain, cases, fakeDecider(answering(0.8, () => STOP_KEY)), options);
		await runCases(domain, cases, fakeDecider(answering(0.8, () => STOP_KEY)), options);
		expect(lines).toContain("c1: already done");
		const other = { ...fakeDecider(answering(0.8, () => STOP_KEY)), model: "fake/other" };
		await expect(runCases(domain, [], other, options)).rejects.toThrow(RunMismatchError);
		const renamed = runnerOf({
			...FACTS,
			stop: "Enough",
			caseId: () => Promise.resolve("c1"),
			load: () => Promise.reject(new Error("never")),
		});
		await expect(runCases(renamed, [], fakeDecider(answering(0.8)), options)).rejects.toThrow(RunMismatchError);
	});

	it("records and counts every failure: of the answers, of a pick, and of a case that throws", async () => {
		const lines: string[] = [];
		const options = { out: join(folder, "out"), concurrency: 1, log: (line: string) => lines.push(line) };
		const broken = fakeDecider((request, call) =>
			PICK_ID in request.decisionQuestions ? answering(0.5, () => STOP_KEY)(request, call) : failing("down"),
		);
		await runCases(await factsSetup(), [await factsFolder(folder, "c1")], broken, options);
		expect(lines).toEqual([expect.stringMatching(/^c1: 1 steps, .* \| ERROR down$/)]);
		const out = join(folder, "out");
		expect(await readResult(out, "c1")).toMatchObject({ ended: "stop", error: "down", answers: null });

		const throwing: Runner = runnerOf({
			...FACTS,
			caseId: () => Promise.resolve("c2"),
			load: () =>
				Promise.resolve({
					...factsMachine({ facts: { a: "fact a" } }),
					transition: () => Promise.reject(new Error("the transition broke")),
				}),
		});
		const failingPick = fakeDecider((request, call) =>
			call === 1 ? failing("down") : answering(0.5)(request, call),
		);
		const two = join(folder, "two");
		await runCases(throwing, [join(folder, "c2")], fakeDecider(picking(1)), { ...options, out: two });
		expect(await readResult(two, "c2")).toMatchObject({ ended: null, error: "the transition broke", steps: 1 });
		expect((await traceOf("two", "c2")).at(-1)).toEqual({
			type: "note",
			message: "the case failed: the transition broke",
		});
		await runCases(await factsSetup(), [await factsFolder(folder, "c3")], failingPick, { ...options, out: two });
		expect(await readResult(two, "c3")).toMatchObject({ ended: "pick failed", error: null });
		expect((await runRecord("two")).totals).toMatchObject({ cases: 2, failed: 2 });
		// A case that failed before its steps ended is run again when the run goes on.
		lines.length = 0;
		await runCases(throwing, [join(folder, "c2")], fakeDecider(picking(1)), { ...options, out: two });
		expect(lines).toEqual([expect.stringMatching(/^c2: .* \| ERROR the transition broke$/)]);
	});
});

describe("runCases --state-from", () => {
	it("repeats each case's steps under the earlier run's limits, and asks the model only the questions", async () => {
		const cases = [await factsFolder(folder, "c1")];
		await runCases(await factsSetup(), cases, fakeDecider(picking(1)), { ...quiet, out: join(folder, "first") });
		// The domain's own limits now allow one step less than the first run took; the run takes the first run's.
		const tighter = runnerOf({
			...FACTS,
			limits: { ...FACTS.limits, steps: 1 },
			caseId: () => Promise.resolve("c1"),
			load: () => Promise.resolve(factsMachine({ facts: { a: "fact a", b: "fact b" } })),
		});
		const second = fakeDecider(answering(0.3, () => STOP_KEY));
		await runCases(tighter, cases, second, {
			...quiet,
			out: join(folder, "second"),
			stateFrom: join(folder, "first"),
		});

		expect(second.requests.map((request) => Object.keys(request.decisionQuestions))).toEqual([["a", "b"]]);
		expect(await runRecord("second")).toMatchObject({
			stateFrom: join(folder, "first"),
			limits: FACTS.limits,
			totals: { calls: 1 },
		});
		const states = async (name: string) =>
			(await traceOf(name, "c1")).flatMap((entry) => (entry.type === "state" ? [entry.state] : []));
		expect(await states("second")).toEqual(await states("first"));
		expect((await states("first")).at(-1)).toEqual({ looked: ["a"], found: ["fact a"] });
		const picks = (await traceOf("second", "c1")).filter((entry) => entry.type === "pick");
		expect(picks.every((pick) => pick.repeated === true)).toBe(true);
		expect(await readResult(join(folder, "second"), "c1")).toMatchObject({
			steps: 2,
			ended: "stop",
			answers: { a: { probability: 0.3 } },
		});
	});
});

describe("replayCase", () => {
	it("repeats a case from its trace, and with --out writes it as a run of one case", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		await runCases(domain, [c1], fakeDecider(picking(1)), { ...quiet, out: join(folder, "out") });
		const trace = caseFile("out", "c1", "trace.jsonl");
		const recorded = await readResult(join(folder, "out"), "c1");
		const replayed = await replayCase(domain, c1, trace);
		expect(replayed).toEqual(recorded);

		const written = await replayCase(domain, c1, trace, { out: join(folder, "again") });
		expect(written).toEqual(recorded);
		expect(await runRecord("again")).toMatchObject({
			model: "fake/decider",
			replay: { trace, fork: null },
			totals: { cases: 1, calls: 0 },
		});
		expect((await traceOf("again", "c1")).filter((entry) => entry.type === "pick")).toHaveLength(2);
	});

	it("forks with the model that goes on, which it needs", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		await runCases(domain, [c1], fakeDecider(picking(1)), { ...quiet, out: join(folder, "out") });
		const trace = caseFile("out", "c1", "trace.jsonl");
		await expect(replayCase(domain, c1, trace, { fork: 1 })).rejects.toThrow(/needs the decider/);
		const then = fakeDecider(picking(1, 0.2));
		const forked = await replayCase(domain, c1, trace, { fork: 1, decider: then });
		expect(forked).toMatchObject({ model: "fake/decider", steps: 2, ended: "no choices" });
		expect(forked.answers?.["a"]).toEqual({ type: "bool", probability: 0.2 });
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

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inPool, replayCase, RunMismatchError, runCases } from "../../src/cli/commands.ts";
import { commandLine } from "../../src/cli/program.ts";
import { readResult, runRecordSchema } from "../../src/cli/runs.ts";
import { loadSet } from "../../src/cli/sets.ts";
import {
	type JsonObject,
	parseRequests,
	parseTrace,
	PICK_ID,
	type RunResult,
	type Runner,
	runnerOf,
	type StateMachine,
} from "../../src/core/index.ts";
import { factsFolder, factsSetup } from "../helpers/facts.ts";
import {
	answering,
	FACTS,
	factsMachine,
	type FactsState,
	failing,
	fakeDecider,
	type Policy,
} from "../helpers/fakes.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

const caseFile = (run: string, id: string, name: string) => join(folder, run, "cases", id, name);
const runRecord = async (run: string) =>
	runRecordSchema.parse(JSON.parse(await readFile(join(folder, run, "run.json"), "utf8")));
const traceOf = async (run: string, id: string) => parseTrace(await readFile(caseFile(run, id, "trace.jsonl"), "utf8"));
const quiet = { concurrency: 1, progress: () => undefined };
/** The facts domain with `machine` for every case, and `outcome`; every case has the id of its folder. */
const factsWith = (
	machine: (folder: string) => Promise<StateMachine<FactsState>>,
	outcome?: (result: RunResult<FactsState>) => JsonObject,
): Runner =>
	runnerOf({
		...FACTS,
		caseId: (path) => Promise.resolve(basename(path)),
		load: machine,
		...(outcome === undefined ? {} : { outcome }),
	});
/** Looks up the first fact `n` times, then stops looking, and answers every fact with `probability`. */
const looksUp = (n: number, probability = 0.8): Policy => {
	let calls = 0;
	return answering(probability, (labels) => (calls++ < n ? (labels[0] ?? "o1") : (labels.at(-1) ?? "o1")));
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
			progress: (line: string) => lines.push(line),
			set: { name: "s", file: "set.json" },
		};
		await runCases(domain, cases, fakeDecider(looksUp(0)), options);
		expect(await runRecord("out")).toMatchObject({
			domain: "facts",
			version: "1.0.0",
			definition: { name: "facts", hash: domain.definition.hash, content: { limits: FACTS.limits } },
			model: "fake/decider",
			limits: FACTS.limits,
			switch: { version: expect.any(String) as unknown },
			finished: expect.stringMatching(/^\d{4}-/) as unknown,
			set: { name: "s", file: "set.json" },
			replay: null,
			totals: { cases: 3, failed: 1, requests: 4, usage: { input: 40, totalTokens: 40, cost: { total: 0.004 } } },
		});
		expect(await readResult(join(folder, "out"), "c1")).toEqual({
			case: "c1",
			domain: "facts",
			version: "1.0.0",
			model: "fake/decider",
			steps: 2,
			ended: "done",
			error: null,
			outcome: { reason: "done", looked: 0, answers: { a: 0.8, b: 0.8 } },
			thrown: null,
		});
		const requests = parseRequests(await readFile(caseFile("out", "c1", "requests.jsonl"), "utf8"));
		expect(requests.map((recorded) => Object.keys(recorded.request.decisionQuestions))).toEqual([
			[PICK_ID],
			["a", "b"],
		]);
		expect(requests[0]?.result).toMatchObject({ stopReason: "stop", decisionUsage: { input: 10 } });
		expect((await traceOf("out", "c1"))[0]).toMatchObject({ case: "c1", definition: domain.definition.hash });
		// A case folder that cannot be read still gets a result and a trace, under the name that the set gives it.
		expect(await readResult(join(folder, "out"), "missing")).toMatchObject({
			steps: 0,
			ended: null,
			thrown: expect.stringMatching(/ENOENT/) as unknown,
		});
		expect((await traceOf("out", "missing")).map((entry) => entry.type)).toEqual(["start", "thrown"]);
		expect(lines).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^c1: 2 steps, \{"reason":"done"/),
				expect.stringMatching(/^missing: 0 steps \| ERROR .*ENOENT/),
			]),
		);
	});

	it("sums the usage counts that only some providers report, once any request has them", async () => {
		const policy = looksUp(0);
		const decider = fakeDecider((request, call) => {
			const result = policy(request, call);
			const usage = result.decisionUsage;
			return call === 2 && usage !== undefined ? { ...result, decisionUsage: { ...usage, reasoning: 5 } } : result;
		});
		await runCases(await factsSetup(), [await factsFolder(folder, "c1")], decider, {
			...quiet,
			out: join(folder, "out"),
		});
		const { totals } = await runRecord("out");
		expect(totals?.usage).toMatchObject({ input: 20, reasoning: 5 });
		expect(totals?.usage.cacheWrite1h).toBeUndefined();
	});

	it("goes on with a stopped run, and refuses a folder of another model or another definition", async () => {
		const domain = await factsSetup();
		const cases = [await factsFolder(folder, "c1")];
		const lines: string[] = [];
		const options = { out: join(folder, "out"), concurrency: 1, progress: (line: string) => lines.push(line) };
		await runCases(domain, cases, fakeDecider(looksUp(0)), options);
		await runCases(domain, cases, fakeDecider(looksUp(0)), options);
		expect(lines).toContain("c1: already done");
		const other = { ...fakeDecider(looksUp(0)), model: "fake/other" };
		await expect(runCases(domain, [], other, options)).rejects.toThrow(RunMismatchError);
		const redefined = runnerOf({
			...FACTS,
			limits: { steps: 9, windowShare: 0.9 },
			caseId: () => Promise.resolve("c1"),
			load: () => Promise.reject(new Error("never")),
		});
		await expect(runCases(redefined, [], fakeDecider(looksUp(0)), options)).rejects.toThrow(RunMismatchError);
	});
});

describe("runCases, when a case fails", () => {
	it("records and counts every failure: of a request, and of a case that throws", async () => {
		const lines: string[] = [];
		const options = { out: join(folder, "out"), concurrency: 1, progress: (line: string) => lines.push(line) };
		const broken = fakeDecider((request, call) =>
			PICK_ID in request.decisionQuestions ? looksUp(0)(request, call) : failing("down"),
		);
		await runCases(await factsSetup(), [await factsFolder(folder, "c1")], broken, options);
		expect(lines).toEqual([expect.stringMatching(/^c1: 2 steps, .* \(failed\) \| ERROR down$/)]);
		const out = join(folder, "out");
		expect(await readResult(out, "c1")).toMatchObject({ steps: 2, ended: "failed", error: "down", thrown: null });

		const throwing = factsWith(() =>
			Promise.resolve({
				...factsMachine({ facts: { a: "fact a" } }),
				transition: () => Promise.reject(new Error("the transition broke")),
			}),
		);
		const two = join(folder, "two");
		await runCases(throwing, [join(folder, "c2")], fakeDecider(looksUp(1)), { ...options, out: two });
		expect(await readResult(two, "c2")).toMatchObject({
			ended: null,
			error: null,
			thrown: "the transition broke",
			steps: 1,
		});
		expect((await traceOf("two", "c2")).at(-1)).toEqual({ type: "thrown", error: "the transition broke" });
		const failsFirst = fakeDecider(() => failing("down"));
		await runCases(await factsSetup(), [await factsFolder(folder, "c3")], failsFirst, { ...options, out: two });
		expect(await readResult(two, "c3")).toMatchObject({ steps: 1, ended: "failed", error: "down" });
		expect((await runRecord("two")).totals).toMatchObject({ cases: 2, failed: 2 });
		// A case that threw is run again when the run goes on, without its old result while it runs.
		lines.length = 0;
		let resultWhileRunning = true;
		const again = factsWith(async () => {
			resultWhileRunning = await access(caseFile("two", "c2", "result.json")).then(
				() => true,
				() => false,
			);
			return factsMachine({ facts: { a: "fact a" } });
		});
		await runCases(again, [join(folder, "c2")], fakeDecider(looksUp(1)), { ...options, out: two });
		expect(resultWhileRunning).toBe(false);
		expect(lines).toEqual(["c2: 3 steps"]);
		expect(await readResult(two, "c2")).toMatchObject({ ended: "done", thrown: null });
	});

	it("records how the run ended of a case that throws after it, and the steps of one that throws in a step", async () => {
		const out = join(folder, "out");
		const outcomeFails = factsWith(
			() => Promise.resolve(factsMachine({ facts: { a: "fact a" } })),
			() => {
				throw new Error("no outcome");
			},
		);
		await runCases(outcomeFails, [join(folder, "c1")], fakeDecider(looksUp(0)), { ...quiet, out });
		expect(await readResult(out, "c1")).toMatchObject({
			steps: 2,
			ended: "done",
			error: null,
			outcome: null,
			thrown: "no outcome",
		});
		const viewFails = factsWith(() =>
			Promise.resolve({
				...factsMachine({ facts: { a: "fact a" } }),
				view: (state) =>
					state.stopped
						? Promise.reject(new Error("an image is missing"))
						: Promise.resolve({ decisionState: state }),
			}),
		);
		await runCases(viewFails, [join(folder, "c2")], fakeDecider(looksUp(0)), { ...quiet, out });
		expect(await readResult(out, "c2")).toMatchObject({ steps: 2, ended: null, thrown: "an image is missing" });
	});

	it("refuses a set's case whose id is not its folder's name, and records it", async () => {
		const out = join(folder, "out");
		const renamed = join(folder, "cases", "c9");
		await mkdir(renamed, { recursive: true });
		await writeFile(join(renamed, "facts.json"), JSON.stringify({ id: "c1", facts: { a: "fact a" } }));
		await runCases(await factsSetup(), [renamed], fakeDecider(looksUp(0)), {
			...quiet,
			out,
			set: { name: "s", file: "set.json" },
		});
		expect(await readResult(out, "c9")).toMatchObject({
			ended: null,
			thrown: `the case in ${renamed} has the id c1, but the set names it c9`,
		});
	});
});

describe("replayCase", () => {
	it("repeats a case from its trace, and with --out writes it as a run of one case", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		await runCases(domain, [c1], fakeDecider(looksUp(1)), { ...quiet, out: join(folder, "out") });
		const trace = caseFile("out", "c1", "trace.jsonl");
		const recorded = await readResult(join(folder, "out"), "c1");
		const replayed = await replayCase(domain, c1, trace);
		expect(replayed).toEqual(recorded);

		const written = await replayCase(domain, c1, trace, { out: join(folder, "again") });
		expect(written).toEqual(recorded);
		expect(await runRecord("again")).toMatchObject({
			model: "fake/decider",
			replay: { trace, fork: null },
			totals: { cases: 1, requests: 0 },
		});
		const answers = (await traceOf("again", "c1")).filter((entry) => entry.type === "answers");
		expect(answers.map((entry) => entry.repeated)).toEqual([true, true, true]);
	});

	it("fails, with a non-zero exit code from the command, when the case does not repeat the trace", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		const c2 = await factsFolder(folder, "c2", { z: "other" });
		await runCases(domain, [c1], fakeDecider(looksUp(1)), { ...quiet, out: join(folder, "out") });
		const trace = caseFile("out", "c1", "trace.jsonl");
		expect(await replayCase(domain, c2, trace)).toMatchObject({
			thrown: "the trace is of the case c1, not of c2",
		});
		const written: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation((text) => written.push(String(text)) > 0);
		await commandLine({ facts: { setup: factsSetup } }).parseAsync(["replay", c2, trace], { from: "user" });
		expect(process.exitCode).toBe(1);
		expect(written).toEqual(["the replay failed: the trace is of the case c1, not of c2\n"]);
	});

	it("forks with the model that goes on, which it needs", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		await runCases(domain, [c1], fakeDecider(looksUp(1)), { ...quiet, out: join(folder, "out") });
		const trace = caseFile("out", "c1", "trace.jsonl");
		await expect(replayCase(domain, c1, trace, { fork: 1 })).rejects.toThrow(/needs the decider/);
		const forked = await replayCase(domain, c1, trace, { fork: 1, decider: fakeDecider(looksUp(1, 0.2)) });
		expect(forked).toMatchObject({ model: "fake/decider", steps: 4, ended: "done" });
		expect(forked.outcome).toMatchObject({ looked: 2, answers: { a: 0.2, b: 0.2 } });
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

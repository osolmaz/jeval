import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inPool, replayCase, RunMismatchError, runCases } from "../../src/cli/commands.ts";
import { commandLine } from "../../src/cli/program.ts";
import { readResult, runRecordSchema } from "../../src/cli/runs.ts";
import { loadSet } from "../../src/cli/sets.ts";
import {
	type BoundChoice,
	type JsonObject,
	parseRequests,
	parseTrace,
	PICK_ID,
	type RunResult,
	type Runner,
	runnerOf,
	type StateMachine,
	STOP_KEY,
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
	machine: (folder: string) => Promise<StateMachine<FactsState, BoundChoice<FactsState>>>,
	outcome?: (result: RunResult<FactsState>) => JsonObject,
): Runner =>
	runnerOf({
		...FACTS,
		caseId: (path) => Promise.resolve(basename(path)),
		load: machine,
		...(outcome === undefined ? {} : { outcome }),
	});
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
			progress: (line: string) => lines.push(line),
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
			totals: { cases: 3, failed: 1, requests: 4, usage: { input: 40, totalTokens: 40, cost: { total: 0.004 } } },
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
				expect.stringMatching(/^c1: 1 steps, \{"result":"answered"/),
				expect.stringMatching(/^missing: - \| ERROR .*ENOENT/),
			]),
		);
	});

	it("sums the usage counts that only some providers report, once any request has them", async () => {
		const policy = answering(0.8, () => STOP_KEY);
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
});

describe("runCases, when a case fails", () => {
	it("records and counts every failure: of the answers, of a pick, and of a case that throws", async () => {
		const lines: string[] = [];
		const options = { out: join(folder, "out"), concurrency: 1, progress: (line: string) => lines.push(line) };
		const broken = fakeDecider((request, call) =>
			PICK_ID in request.decisionQuestions ? answering(0.5, () => STOP_KEY)(request, call) : failing("down"),
		);
		await runCases(await factsSetup(), [await factsFolder(folder, "c1")], broken, options);
		expect(lines).toEqual([expect.stringMatching(/^c1: 1 steps, .* \| ERROR down$/)]);
		const out = join(folder, "out");
		expect(await readResult(out, "c1")).toMatchObject({ ended: "stop", error: "down", answers: null, thrown: null });

		const throwing = factsWith(() =>
			Promise.resolve({
				...factsMachine({ facts: { a: "fact a" } }),
				transition: () => Promise.reject(new Error("the transition broke")),
			}),
		);
		const failingPick = fakeDecider((request, call) =>
			call === 1 ? failing("down") : answering(0.5)(request, call),
		);
		const two = join(folder, "two");
		await runCases(throwing, [join(folder, "c2")], fakeDecider(picking(1)), { ...options, out: two });
		expect(await readResult(two, "c2")).toMatchObject({
			ended: null,
			error: null,
			thrown: "the transition broke",
			steps: 1,
		});
		expect((await traceOf("two", "c2")).at(-1)).toEqual({ type: "thrown", error: "the transition broke" });
		await runCases(await factsSetup(), [await factsFolder(folder, "c3")], failingPick, { ...options, out: two });
		expect(await readResult(two, "c3")).toMatchObject({ ended: "pick failed", error: null });
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
		await runCases(again, [join(folder, "c2")], fakeDecider(picking(1)), { ...options, out: two });
		expect(resultWhileRunning).toBe(false);
		expect(lines).toEqual(["c2: look-up:a (no choices)"]);
		expect(await readResult(two, "c2")).toMatchObject({ ended: "no choices", thrown: null });
	});

	it("records how the steps ended and the answers of a case that throws after its steps", async () => {
		const out = join(folder, "out");
		const outcomeFails = factsWith(
			() => Promise.resolve(factsMachine({ facts: { a: "fact a" } })),
			() => {
				throw new Error("no outcome");
			},
		);
		await runCases(outcomeFails, [join(folder, "c1")], fakeDecider(picking(0)), { ...quiet, out });
		expect(await readResult(out, "c1")).toMatchObject({
			steps: 1,
			ended: "stop",
			error: null,
			answers: { a: { type: "bool", probability: 0.8 } },
			outcome: null,
			thrown: "no outcome",
		});
		const stageFails = factsWith(() =>
			Promise.resolve({
				...factsMachine({ facts: { a: "fact a" } }),
				answer: () => Promise.reject(new Error("an image is missing")),
			}),
		);
		await runCases(stageFails, [join(folder, "c2")], fakeDecider(picking(0)), { ...quiet, out });
		expect(await readResult(out, "c2")).toMatchObject({
			ended: "stop",
			error: null,
			answers: null,
			thrown: "an image is missing",
		});
	});

	it("refuses a set's case whose id is not its folder's name, and records it", async () => {
		const out = join(folder, "out");
		const renamed = join(folder, "cases", "c9");
		await mkdir(renamed, { recursive: true });
		await writeFile(join(renamed, "facts.json"), JSON.stringify({ id: "c1", facts: { a: "fact a" } }));
		await runCases(await factsSetup(), [renamed], fakeDecider(picking(0)), {
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
			stateFrom: relative(process.cwd(), join(folder, "first")),
		});

		expect(second.requests.map((request) => Object.keys(request.decisionQuestions))).toEqual([["a", "b"]]);
		// The earlier run is recorded by its full path, so the run can go on from another folder.
		expect(await runRecord("second")).toMatchObject({
			stateFrom: join(folder, "first"),
			limits: FACTS.limits,
			totals: { requests: 1 },
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

	it("records a case that the earlier run does not have as a failure of its own", async () => {
		const first = join(folder, "first");
		await runCases(await factsSetup(), [await factsFolder(folder, "c1")], fakeDecider(picking(0)), {
			...quiet,
			out: first,
		});
		const out = join(folder, "second");
		const c2 = await factsFolder(folder, "c2");
		await runCases(await factsSetup(), [c2], fakeDecider(picking(0)), { ...quiet, out, stateFrom: first });
		expect(await readResult(out, "c2")).toMatchObject({
			ended: null,
			thrown: expect.stringMatching(/ENOENT/) as unknown,
		});
		expect((await runRecord("second")).totals).toMatchObject({ cases: 1, failed: 1, requests: 0 });
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
			totals: { cases: 1, requests: 0 },
		});
		expect((await traceOf("again", "c1")).filter((entry) => entry.type === "pick")).toHaveLength(2);
	});

	it("fails, with a non-zero exit code from the command, when the case does not repeat the trace", async () => {
		const domain = await factsSetup();
		const c1 = await factsFolder(folder, "c1");
		const c2 = await factsFolder(folder, "c2", { z: "other" });
		await runCases(domain, [c1], fakeDecider(picking(1)), { ...quiet, out: join(folder, "out") });
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

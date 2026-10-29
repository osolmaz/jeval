import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { z } from "zod";
import {
	type Decider,
	type DecisionUsage,
	type decisionUsageSchema,
	type Limits,
	parseRequests,
	parseTrace,
	recordedModel,
	recording,
	type Replay,
	replayOf,
	type Runner,
	Trace,
} from "../core/index.ts";
import { type CaseFiles, caseFiles, casesFolder, jsonLines, runFile } from "./layout.ts";
import { type CaseResult, exists, failed, readResult, readResults, readRunRecord, type RunRecord } from "./runs.ts";
import { switchSource } from "./source.ts";

export interface RunCasesOptions {
	readonly out: string;
	readonly concurrency: number;
	/** Gets one line of progress for each case as it ends. */
	readonly progress: (line: string) => void;
	/** The eval set the cases come from. */
	readonly set?: { readonly name: string; readonly file: string };
}

/** The output folder already holds a run of something else. */
export class RunMismatchError extends Error {
	override readonly name = "RunMismatchError";
}

/** Runs `items` with at most `limit` running at once, in order of start. */
export async function inPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			if (item !== undefined) await work(item);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** One case to run: its folder and id, the decider, and the recorded run it repeats, which it reads when it starts. */
interface CaseJob {
	readonly domain: Runner;
	readonly folder: string;
	readonly id: string;
	readonly decider: Decider;
	/** The limits of the run, for the trace of a case that fails before its run starts. */
	readonly limits: Limits;
	/** Checks the case and reads the recorded run that it repeats, if any; a failure here is the case's failure. */
	readonly prepare: () => Promise<Replay | undefined>;
}

/** Where a case writes its trace and requests while it runs. */
interface CaseWriters {
	readonly trace: Trace;
	readonly decider: Decider;
	done(): Promise<void>;
}

/** The case's trace and requests, written to `files` as they come, or kept in memory without files. */
async function writersOf(files: CaseFiles | null, decider: Decider): Promise<CaseWriters> {
	if (files === null) return { trace: new Trace(), decider, done: () => Promise.resolve() };
	await mkdir(files.folder, { recursive: true });
	const traceLines = await jsonLines(files.trace);
	const requestLines = await jsonLines(files.requests);
	return {
		trace: new Trace((entry) => {
			traceLines.add(entry);
		}),
		decider: recording(decider, (recorded) => {
			requestLines.add(recorded);
		}),
		done: async () => {
			await Promise.all([traceLines.done(), requestLines.done()]);
		},
	};
}

const baseOf = (job: CaseJob) => ({
	case: job.id,
	domain: job.domain.name,
	version: job.domain.version,
	model: job.decider.model,
});

/** What a trace holds of a case's steps so far, and how its run ended if it did. */
function recordedSoFar(trace: Trace): Pick<CaseResult, "steps" | "ended" | "error"> {
	const ended = trace.entries.find((entry) => entry.type === "ended");
	if (ended !== undefined) return { steps: ended.steps, ended: ended.ended, error: ended.error };
	return { steps: trace.entries.filter((entry) => entry.type === "questions").length, ended: null, error: null };
}

/**
 * The result of a case that threw: the error, and what its trace holds of its steps. A case that threw before its run
 * started gets the start entry, so that its trace says what failed.
 */
function thrownResult(job: CaseJob, trace: Trace, error: unknown): CaseResult {
	const message = error instanceof Error ? error.message : String(error);
	if (trace.entries[0]?.type !== "start") {
		const { domain } = job;
		const start = { domain: domain.name, version: domain.version, definition: domain.definition.hash };
		trace.started({ ...start, case: job.id, model: job.decider.model, limits: job.limits });
	}
	trace.thrown(message);
	return { ...baseOf(job), ...recordedSoFar(trace), outcome: null, thrown: message };
}

/**
 * Runs one case, into `files` when given: its trace, its requests and its result. A case that runs again first loses
 * its old result, so that it counts as running. A case that throws still gets a result, with the error.
 */
async function runCase(job: CaseJob, files: CaseFiles | null): Promise<CaseResult> {
	if (files !== null) await rm(files.result, { force: true });
	const writers = await writersOf(files, job.decider);
	let record: CaseResult;
	try {
		const replay = await job.prepare();
		const options = { trace: writers.trace, ...(replay === undefined ? {} : { replay }) };
		const { result, outcome } = await job.domain.run(job.folder, writers.decider, options);
		const { steps, ended, error } = result;
		record = { ...baseOf(job), steps, ended, error, outcome, thrown: null };
	} catch (error: unknown) {
		record = thrownResult(job, writers.trace, error);
	}
	await writers.done();
	if (files !== null) await writeFile(files.result, `${JSON.stringify(record, null, 1)}\n`);
	return record;
}

/** One line of progress: the steps and the outcome, and the failure if any. */
function progressLine(record: CaseResult): string {
	const outcome = record.outcome === null ? "" : `, ${JSON.stringify(record.outcome)}`;
	const story = `${String(record.steps)} steps${outcome}`;
	const ending = record.ended === null || record.ended === "done" ? "" : ` (${record.ended})`;
	const failure = record.thrown ?? record.error;
	return `${record.case}: ${story}${ending}${failure === null ? "" : ` | ERROR ${failure}`}`;
}

/** What every case of a run shares. */
interface RunContext {
	readonly domain: Runner;
	readonly decider: Decider;
	readonly limits: Limits;
	readonly out: string;
	readonly progress: (line: string) => void;
	/** Whether the cases come from an eval set, which names each case by its folder. */
	readonly fromSet: boolean;
}

/** A set names each case by its folder, so the case in the folder must have that id. */
async function checkSetId(domain: Runner, folder: string, id: string): Promise<void> {
	const found = await domain.caseId(folder);
	if (found !== id) throw new Error(`the case in ${folder} has the id ${found}, but the set names it ${id}`);
}

async function runOne(run: RunContext, folder: string): Promise<void> {
	const { domain } = run;
	// A case whose id cannot be read is recorded under its folder's name, with the error.
	const id = run.fromSet ? basename(folder) : await domain.caseId(folder).catch(() => basename(folder));
	// A case that threw is run again when a stopped run goes on.
	const before = await readResult(run.out, id);
	if (before !== null && before.thrown === null) {
		run.progress(`${id}: already done`);
		return;
	}
	const prepare = async (): Promise<undefined> => {
		if (run.fromSet) await checkSetId(domain, folder, id);
		return undefined;
	};
	const job = { domain, folder, id, decider: run.decider, limits: run.limits, prepare };
	run.progress(progressLine(await runCase(job, caseFiles(run.out, id))));
}

/** A new run record; `limits` are those that the cases run under, which take the place of the definition's. */
async function recordOf(
	domain: Runner,
	model: string,
	limits: Limits,
	from: Pick<RunRecord, "set" | "replay">,
): Promise<RunRecord> {
	return {
		domain: domain.name,
		version: domain.version,
		definition: domain.definition,
		model,
		limits: { ...limits },
		switch: await switchSource(),
		...from,
		started: new Date().toISOString(),
		finished: null,
		totals: null,
	};
}

/** The run record to start from: `record`, or the folder's own when it holds the same run, which then goes on. */
async function startRun(out: string, record: RunRecord): Promise<RunRecord> {
	if (!(await exists(runFile(out)))) return record;
	const before = await readRunRecord(out);
	const same = (run: RunRecord) =>
		JSON.stringify([
			run.domain,
			run.version,
			run.definition.hash,
			run.model,
			run.limits,
			run.switch.commit,
			run.set,
			run.replay,
		]);
	if (same(before) !== same(record)) {
		throw new RunMismatchError(`${out} holds another run (${same(before)}); use another --out`);
	}
	return { ...record, started: before.started };
}

const noUsage = (): DecisionUsage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** The sum of a count that only some providers report; none while neither usage has it. */
const optionalSum = (a?: number, b?: number): number | undefined =>
	a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** The sum of two usages; a request without usage adds nothing. */
function added(sum: DecisionUsage, usage: z.infer<typeof decisionUsageSchema> | undefined): DecisionUsage {
	if (usage === undefined) return sum;
	const { cost } = usage;
	const cacheWrite1h = optionalSum(sum.cacheWrite1h, usage.cacheWrite1h);
	const reasoning = optionalSum(sum.reasoning, usage.reasoning);
	return {
		input: sum.input + usage.input,
		output: sum.output + usage.output,
		cacheRead: sum.cacheRead + usage.cacheRead,
		cacheWrite: sum.cacheWrite + usage.cacheWrite,
		...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
		...(reasoning === undefined ? {} : { reasoning }),
		totalTokens: sum.totalTokens + usage.totalTokens,
		cost: {
			input: sum.cost.input + cost.input,
			output: sum.cost.output + cost.output,
			cacheRead: sum.cost.cacheRead + cost.cacheRead,
			cacheWrite: sum.cost.cacheWrite + cost.cacheWrite,
			total: sum.cost.total + cost.total,
		},
	};
}

/** The totals of every case in the run folder: from their results, and from every request in their requests files. */
async function totals(out: string): Promise<NonNullable<RunRecord["totals"]>> {
	let sum = { cases: 0, failed: 0, requests: 0, usage: noUsage() };
	for (const result of await readResults(out)) {
		const requests = parseRequests(await readFile(caseFiles(out, result.case).requests, "utf8"));
		const usage = requests.reduce((total, recorded) => added(total, recorded.result.decisionUsage), sum.usage);
		sum = {
			cases: sum.cases + 1,
			failed: sum.failed + (failed(result) ? 1 : 0),
			requests: sum.requests + requests.length,
			usage,
		};
	}
	return sum;
}

/** Writes the finished run record, with its totals. */
async function finishRun(out: string, record: RunRecord): Promise<void> {
	const finished = { ...record, finished: new Date().toISOString(), totals: await totals(out) };
	await writeFile(runFile(out), `${JSON.stringify(finished, null, 1)}\n`);
}

/**
 * Runs a domain on case folders into one run folder: `run.json`, and for each case its result, trace and requests.
 * Cases already done are skipped, so a stopped run goes on where it stopped; a folder of another run is refused.
 */
export async function runCases(
	domain: Runner,
	folders: readonly string[],
	decider: Decider,
	options: RunCasesOptions,
): Promise<void> {
	await mkdir(casesFolder(options.out), { recursive: true });
	const { limits } = domain;
	const from = { set: options.set ?? null, replay: null };
	const record = await startRun(options.out, await recordOf(domain, decider.model, limits, from));
	await writeFile(runFile(options.out), `${JSON.stringify(record, null, 1)}\n`);
	const { out, progress } = options;
	const run: RunContext = { domain, decider, limits, out, progress, fromSet: options.set !== undefined };
	await inPool(folders, options.concurrency, async (folder) => {
		try {
			await runOne(run, folder);
		} catch (error: unknown) {
			progress(`${basename(folder)}: FAILED ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	await finishRun(options.out, record);
}

export interface ReplayCaseOptions {
	/** Repeat only this many steps, and let `decider` answer after them. */
	readonly fork?: number;
	/** The model of a fork. */
	readonly decider?: Decider;
	/** A run folder to write the replay to, as a run of one case. */
	readonly out?: string;
}

/**
 * Runs a case again from its trace, under the trace's limits: every recorded answer, state and ending; or, with a
 * fork, the first `fork` steps, after which `decider` answers. Returns the case's result, whose `thrown` says why the
 * replay failed, such as a recorded answer that does not fit the questions any more; with `out`, it writes the replay
 * as a run of one case.
 */
export async function replayCase(
	domain: Runner,
	folder: string,
	tracePath: string,
	options: ReplayCaseOptions = {},
): Promise<CaseResult> {
	const entries = parseTrace(await readFile(tracePath, "utf8"));
	const { fork } = options;
	const decider = fork === undefined ? recordedModel(entries) : options.decider;
	if (decider === undefined) throw new Error("a fork needs the decider that goes on after it");
	const replay = replayOf(entries, fork === undefined ? {} : { fork });
	const id = await domain.caseId(folder);
	const job = { domain, folder, id, decider, limits: replay.start.limits, prepare: () => Promise.resolve(replay) };
	if (options.out === undefined) return runCase(job, null);
	await mkdir(casesFolder(options.out), { recursive: true });
	const from = { set: null, replay: { trace: resolve(tracePath), fork: fork ?? null } };
	const record = await startRun(options.out, await recordOf(domain, decider.model, job.limits, from));
	await writeFile(runFile(options.out), `${JSON.stringify(record, null, 1)}\n`);
	const result = await runCase(job, caseFiles(options.out, id));
	await finishRun(options.out, record);
	return result;
}

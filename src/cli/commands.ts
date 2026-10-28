import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
	type Decider,
	type DecisionUsage,
	type Limits,
	limitsOf,
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
	readonly log: (line: string) => void;
	/**
	 * A run whose steps each case repeats: the recorded picks and states, under the recorded limits, and how the steps
	 * ended. Only the questions go to the model again.
	 */
	readonly stateFrom?: string;
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

/** How one case runs: the decider, the limits, and the recorded trace that the case repeats, if any. */
interface CasePlan {
	readonly decider: Decider;
	readonly limits: Limits;
	readonly replay?: Replay;
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

/**
 * Runs one case by `plan`, into `files` when given: its trace, its requests and its result. A case that fails before
 * its steps end still gets a result, with its error and no ending, and a note at the end of its trace.
 */
async function runCase(
	domain: Runner,
	folder: string,
	id: string,
	plan: CasePlan,
	files: CaseFiles | null,
): Promise<CaseResult> {
	const writers = await writersOf(files, plan.decider);
	const base = { case: id, domain: domain.name, version: domain.version, model: plan.decider.model };
	let record: CaseResult;
	try {
		const options = { limits: plan.limits, trace: writers.trace, ...(plan.replay ? { replay: plan.replay } : {}) };
		const { result, outcome } = await domain.run(folder, writers.decider, options);
		const { steps, ended, error, answers } = result;
		record = { ...base, steps, ended, error, answers, outcome };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		writers.trace.note(`the case failed: ${message}`);
		const steps = writers.trace.entries.filter((entry) => entry.type === "choices").length;
		record = { ...base, steps, ended: null, error: message, answers: null, outcome: null };
	}
	await writers.done();
	if (files !== null) await writeFile(files.result, `${JSON.stringify(record, null, 1)}\n`);
	return record;
}

/** One line for the log: the picks, or the steps and the outcome, and the failure if any. */
function storyOf(record: CaseResult, picks: readonly string[]): string {
	const story =
		record.outcome === null
			? picks.join(" > ") || "-"
			: `${String(record.steps)} steps, ${JSON.stringify(record.outcome)}`;
	const ending = record.ended === null || record.ended === "stop" ? "" : ` (${record.ended})`;
	return `${record.case}: ${story}${ending}${record.error === null ? "" : ` | ERROR ${record.error}`}`;
}

/** The plan of a case: the run's decider, with the case's recorded steps when the run repeats another run's. */
async function planOf(domain: Runner, id: string, decider: Decider, stateFrom: string | undefined): Promise<CasePlan> {
	if (stateFrom === undefined) return { decider, limits: domain.limits };
	const entries = parseTrace(await readFile(caseFiles(stateFrom, id).trace, "utf8"));
	return { decider, limits: limitsOf(entries), replay: replayOf(entries, { askAgain: true }) };
}

async function runOne(domain: Runner, folder: string, decider: Decider, options: RunCasesOptions): Promise<void> {
	const id = await domain.caseId(folder);
	// A case that failed before its steps ended is run again when a stopped run goes on.
	if ((await readResult(options.out, id))?.ended != null) {
		options.log(`${id}: already done`);
		return;
	}
	const files = caseFiles(options.out, id);
	const plan = await planOf(domain, id, decider, options.stateFrom);
	const record = await runCase(domain, folder, id, plan, files);
	const picks = parseTrace(await readFile(files.trace, "utf8")).flatMap((entry) =>
		entry.type === "pick" ? [entry.choice] : [],
	);
	options.log(storyOf(record, picks));
}

/** A new run record; `limits` are those that the cases run under. */
async function recordOf(
	domain: Runner,
	model: string,
	limits: Limits,
	from: Pick<RunRecord, "set" | "stateFrom" | "replay">,
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
			run.stateFrom,
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

/** The sum of two usages, without the counts that only some providers report; a request without usage adds nothing. */
function added(
	sum: DecisionUsage,
	usage: Omit<DecisionUsage, "cacheWrite1h" | "reasoning"> | undefined,
): DecisionUsage {
	if (usage === undefined) return sum;
	const { cost } = usage;
	return {
		input: sum.input + usage.input,
		output: sum.output + usage.output,
		cacheRead: sum.cacheRead + usage.cacheRead,
		cacheWrite: sum.cacheWrite + usage.cacheWrite,
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
	let sum = { cases: 0, failed: 0, calls: 0, usage: noUsage() };
	for (const result of await readResults(out)) {
		const requests = parseRequests(await readFile(caseFiles(out, result.case).requests, "utf8"));
		const usage = requests.reduce((total, recorded) => added(total, recorded.result.decisionUsage), sum.usage);
		sum = {
			cases: sum.cases + 1,
			failed: sum.failed + (failed(result) ? 1 : 0),
			calls: sum.calls + requests.length,
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

/** The limits of a run that repeats `stateFrom`'s steps: that run's, so that every case repeats its steps exactly. */
async function limitsFor(domain: Runner, stateFrom: string | undefined): Promise<Limits> {
	return stateFrom === undefined ? domain.limits : (await readRunRecord(stateFrom)).limits;
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
	const limits = await limitsFor(domain, options.stateFrom);
	const from = { set: options.set ?? null, stateFrom: options.stateFrom ?? null, replay: null };
	const record = await startRun(options.out, await recordOf(domain, decider.model, limits, from));
	await writeFile(runFile(options.out), `${JSON.stringify(record, null, 1)}\n`);
	await inPool(folders, options.concurrency, async (folder) => {
		try {
			await runOne(domain, folder, decider, options);
		} catch (error: unknown) {
			options.log(`${basename(folder)}: FAILED ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	await finishRun(options.out, record);
}

export interface ReplayCaseOptions {
	/** Repeat only this many steps, and let `decider` pick and answer after them. */
	readonly fork?: number;
	/** The model of a fork. */
	readonly decider?: Decider;
	/** A run folder to write the replay to, as a run of one case. */
	readonly out?: string;
}

/**
 * Runs a case again from its trace, under the trace's limits: every recorded pick, state, ending and answer; or, with
 * a fork, the first `fork` steps, after which `decider` picks and answers. Returns the case's result, and with `out`
 * writes the replay as a run of one case.
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
	const plan = { decider, limits: limitsOf(entries), replay };
	const id = await domain.caseId(folder);
	if (options.out === undefined) return runCase(domain, folder, id, plan, null);
	await mkdir(casesFolder(options.out), { recursive: true });
	const from = { set: null, stateFrom: null, replay: { trace: resolve(tracePath), fork: fork ?? null } };
	const record = await startRun(options.out, await recordOf(domain, plan.decider.model, plan.limits, from));
	await writeFile(runFile(options.out), `${JSON.stringify(record, null, 1)}\n`);
	const result = await runCase(domain, folder, id, plan, caseFiles(options.out, id));
	await finishRun(options.out, record);
	return result;
}

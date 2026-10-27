import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
	type CaseRun,
	type Decider,
	type Fork,
	limitsOf,
	parseTrace,
	recording,
	type Replay,
	replayOf,
	type Runner,
	Trace,
} from "../core/index.ts";
import { caseFiles, casesFolder, jsonLines, runFile } from "./layout.ts";
import { type CaseResult, exists, readResults, readRunRecord, type RunRecord } from "./runs.ts";
import { switchSource } from "./source.ts";

export interface RunCasesOptions {
	readonly out: string;
	readonly concurrency: number;
	readonly log: (line: string) => void;
	/**
	 * A run whose steps each case takes again: its recorded choices and observations are repeated, and only the answers
	 * go to the model again.
	 */
	readonly stepsFrom?: string;
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

async function runOne(domain: Runner, folder: string, decider: Decider, options: RunCasesOptions): Promise<void> {
	const id = await domain.caseId(folder);
	const files = caseFiles(options.out, id);
	if (await exists(files.result)) {
		options.log(`${id}: already done`);
		return;
	}
	await mkdir(files.folder, { recursive: true });
	const traceLines = await jsonLines(files.trace);
	const requestLines = await jsonLines(files.requests);
	const trace = new Trace((entry) => {
		traceLines.add(entry);
	});
	const recorded = recording(decider, (exchange) => {
		requestLines.add(exchange);
	});
	const { decider: caseDecider, ...replaying } = await stepsOf(options.stepsFrom, id, recorded);
	const { result, outcome } = await domain.run(folder, caseDecider, {
		limits: domain.limits,
		trace,
		...replaying,
	});
	await Promise.all([traceLines.done(), requestLines.done()]);
	const record: CaseResult = {
		case: id,
		domain: domain.name,
		version: domain.version,
		model: decider.model,
		steps: result.steps,
		error: result.error,
		answers: result.answers,
		outcome,
	};
	await writeFile(files.result, `${JSON.stringify(record, null, 1)}\n`);
	const chosen = trace.entries.flatMap((entry) => (entry.type === "choice" ? [entry.key] : []));
	const story =
		outcome === null ? chosen.join(" > ") || "-" : `${String(result.steps)} steps, ${JSON.stringify(outcome)}`;
	options.log(`${id}: ${story}${result.error === null ? "" : ` | ERROR ${result.error}`}`);
}

/**
 * The decider of a case: `then` alone, or with the run `from`, a replay of every step that the case recorded there, so
 * that its steps are taken again as they were and `then` only answers.
 */
async function stepsOf(
	from: string | undefined,
	id: string,
	then: Decider,
): Promise<{ decider: Decider; replay?: Replay }> {
	if (from === undefined) return { decider: then };
	const entries = parseTrace(await readFile(caseFiles(from, id).trace, "utf8"));
	return replayOf(entries, { steps: entries.filter((entry) => entry.type === "choice").length, then });
}

/** The run record to start from: a new one, or the folder's own when it holds the same run, which then goes on. */
async function startRun(domain: Runner, decider: Decider, options: RunCasesOptions): Promise<RunRecord> {
	const record: RunRecord = {
		domain: domain.name,
		version: domain.version,
		definition: domain.definition,
		model: decider.model,
		limits: { ...domain.limits },
		switch: await switchSource(),
		set: options.set ?? null,
		stepsFrom: options.stepsFrom ?? null,
		started: new Date().toISOString(),
		finished: null,
		totals: null,
	};
	if (!(await exists(runFile(options.out)))) return record;
	const before = await readRunRecord(options.out);
	const same = (run: RunRecord) =>
		JSON.stringify([run.domain, run.version, run.model, run.limits, run.switch.commit, run.set, run.stepsFrom]);
	if (same(before) !== same(record)) {
		throw new RunMismatchError(`${options.out} holds another run (${same(before)}); use another --out`);
	}
	return { ...record, started: before.started };
}

/** The totals of every case in the run folder, from their results and request files. */
async function totals(out: string): Promise<NonNullable<RunRecord["totals"]>> {
	const sum = { cases: 0, failed: 0, calls: 0, inputTokens: 0 };
	for (const result of await readResults(out)) {
		sum.cases += 1;
		if (result.error !== null) sum.failed += 1;
		const lines = (await readFile(caseFiles(out, result.case).requests, "utf8")).split("\n").filter(Boolean);
		sum.calls += lines.length;
		for (const line of lines) {
			const usage = (JSON.parse(line) as { result: { usage: { inputTokens: number | null } } }).result.usage;
			sum.inputTokens += usage.inputTokens ?? 0;
		}
	}
	return sum;
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
	const record = await startRun(domain, decider, options);
	await writeFile(runFile(options.out), `${JSON.stringify(record, null, 1)}\n`);
	await inPool(folders, options.concurrency, async (folder) => {
		try {
			await runOne(domain, folder, decider, options);
		} catch (error: unknown) {
			options.log(`${basename(folder)}: FAILED ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	const finished = { ...record, finished: new Date().toISOString(), totals: await totals(options.out) };
	await writeFile(runFile(options.out), `${JSON.stringify(finished, null, 1)}\n`);
}

/**
 * Runs a case again from its trace: the recorded steps with their recorded observations, then `fork.then` from step
 * `fork.steps` when given.
 */
export async function replayCase(domain: Runner, folder: string, tracePath: string, fork?: Fork): Promise<CaseRun> {
	const entries = parseTrace(await readFile(tracePath, "utf8"));
	const { decider, replay } = replayOf(entries, fork);
	return domain.run(folder, decider, { limits: limitsOf(entries), trace: new Trace(), replay });
}

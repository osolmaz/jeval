import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { type Decider, type Fork, limitsOf, parseTrace, recording, replayDecider, Trace } from "../core/index.ts";
import type { CaseRun, DomainEntry } from "./domains.ts";
import { caseFiles, casesFolder, jsonLines, runFile } from "./layout.ts";
import { type CaseResult, exists, readResults, readRunRecord, type RunRecord } from "./runs.ts";
import { jevalSource } from "./source.ts";

export interface RunOptions {
	readonly out: string;
	readonly concurrency: number;
	readonly log: (line: string) => void;
	/** A run whose evidence each case reuses: its recorded steps are repeated, and only the judging is asked again. */
	readonly evidenceFrom?: string;
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

async function runOne(domain: DomainEntry, folder: string, decider: Decider, options: RunOptions): Promise<void> {
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
	const from = options.evidenceFrom;
	const caseDecider = from === undefined ? recorded : await reusing(from, id, recorded);
	const { result, categories } = await domain.run(folder, caseDecider, domain.limits, trace);
	await Promise.all([traceLines.done(), requestLines.done()]);
	const record: CaseResult = {
		case: id,
		domain: domain.name,
		version: domain.version,
		model: decider.model,
		steps: result.steps,
		error: result.error,
		answers: result.answers,
		categories,
	};
	await writeFile(files.result, `${JSON.stringify(record, null, 1)}\n`);
	const chosen = trace.entries.flatMap((entry) => (entry.type === "choice" ? [entry.key] : []));
	options.log(`${id}: ${chosen.join(" > ") || "-"}${result.error === null ? "" : ` | ERROR ${result.error}`}`);
}

/** Repeats every recorded choice of the case in `run`, so its evidence is gathered again as it was; `then` judges. */
async function reusing(run: string, id: string, then: Decider): Promise<Decider> {
	const entries = parseTrace(await readFile(caseFiles(run, id).trace, "utf8"));
	return replayDecider(entries, { steps: entries.filter((entry) => entry.type === "choice").length, then });
}

/** The run record to start from: a new one, or the folder's own when it holds the same run, which then goes on. */
async function startRun(domain: DomainEntry, decider: Decider, options: RunOptions): Promise<RunRecord> {
	const record: RunRecord = {
		domain: domain.name,
		version: domain.version,
		judge: domain.judge,
		model: decider.model,
		limits: { ...domain.limits },
		jeval: await jevalSource(),
		set: options.set ?? null,
		evidenceFrom: options.evidenceFrom ?? null,
		started: new Date().toISOString(),
		finished: null,
		totals: null,
	};
	if (!(await exists(runFile(options.out)))) return record;
	const before = await readRunRecord(options.out);
	const same = (run: RunRecord) =>
		JSON.stringify([run.domain, run.version, run.model, run.limits, run.jeval.commit, run.set, run.evidenceFrom]);
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
	domain: DomainEntry,
	folders: readonly string[],
	decider: Decider,
	options: RunOptions,
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

/** Runs a case again from its trace: the recorded steps, then `fork.then` from step `fork.steps` when given. */
export async function replayCase(
	domain: DomainEntry,
	folder: string,
	tracePath: string,
	fork?: Fork,
): Promise<CaseRun> {
	const entries = parseTrace(await readFile(tracePath, "utf8"));
	return domain.run(folder, replayDecider(entries, fork), limitsOf(entries), new Trace());
}

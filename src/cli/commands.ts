import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import {
	answerSchema,
	type Decider,
	type Fork,
	type Limits,
	limitsOf,
	parseTrace,
	replayDecider,
	Trace,
} from "../core/index.ts";
import { formatReport, labelSchema, type Report, score, type Verdicts } from "../eval/score.ts";
import type { CaseRun, DomainEntry } from "./domains.ts";

/** What `jeval run` writes for each case, next to its trace. */
export const resultSchema = z.object({
	case: z.string(),
	domain: z.string(),
	version: z.string(),
	model: z.string(),
	steps: z.number().int(),
	error: z.string().nullable(),
	answers: z.record(z.string(), answerSchema).nullable(),
	categories: z.record(z.string(), z.string()),
});
export type CaseResult = z.infer<typeof resultSchema>;

export interface RunOptions {
	readonly out: string;
	readonly concurrency: number;
	readonly limits: Limits;
	readonly log: (line: string) => void;
}

const resultPath = (out: string, id: string) => join(out, `${id}.json`);

async function exists(path: string): Promise<boolean> {
	return readFile(path).then(
		() => true,
		() => false,
	);
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
	if (await exists(resultPath(options.out, id))) {
		options.log(`${id}: already done`);
		return;
	}
	const tracePath = join(options.out, `${id}.trace.jsonl`);
	await writeFile(tracePath, "");
	const pending: Promise<void>[] = [];
	const trace = new Trace((entry) => pending.push(appendFile(tracePath, `${JSON.stringify(entry)}\n`)));
	const { result, categories } = await domain.run(folder, decider, options.limits, trace);
	await Promise.all(pending);
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
	await writeFile(resultPath(options.out, id), `${JSON.stringify(record, null, 1)}\n`);
	const chosen = trace.entries.flatMap((entry) => (entry.type === "choice" ? [entry.key] : []));
	options.log(`${id}: ${chosen.join(" > ") || "-"}${result.error === null ? "" : ` | ERROR ${result.error}`}`);
}

/** Runs a domain on case folders and writes each case's result and trace; cases already done are skipped. */
export async function runCases(
	domain: DomainEntry,
	folders: readonly string[],
	decider: Decider,
	options: RunOptions,
): Promise<void> {
	await mkdir(options.out, { recursive: true });
	await inPool(folders, options.concurrency, async (folder) => {
		try {
			await runOne(domain, folder, decider, options);
		} catch (error: unknown) {
			options.log(`${basename(folder)}: FAILED ${error instanceof Error ? error.message : String(error)}`);
		}
	});
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

async function readResults(folder: string): Promise<CaseResult[]> {
	const names = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
	return Promise.all(
		names.map(async (name) => resultSchema.parse(JSON.parse(await readFile(join(folder, name), "utf8")))),
	);
}

/** Scores `jeval run` results against reference labels, on the scheduled cases or, without a list, every labeled result. */
export async function scoreResults(
	resultsFolder: string,
	labelsPath: string,
	scheduledPath?: string,
): Promise<{ report: Report; text: string }> {
	const results = await readResults(resultsFolder);
	const labels = (await readFile(labelsPath, "utf8"))
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => labelSchema.parse(JSON.parse(line)));
	const verdicts = new Map<string, Verdicts>(results.map((result) => [result.case, { answers: result.answers }]));
	const scheduled =
		scheduledPath === undefined
			? new Set(results.map((result) => result.case))
			: new Set((await readFile(scheduledPath, "utf8")).split(/\s+/).filter(Boolean));
	const categories = new Map(
		results.flatMap((result) =>
			Object.entries(result.categories).map(([item, category]) => [`${result.case}/${item}`, category] as const),
		),
	);
	const report = score(
		labels.filter((label) => scheduled.has(label.id)),
		verdicts,
		categories,
	);
	return { report, text: formatReport(report) };
}

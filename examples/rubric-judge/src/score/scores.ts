import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { type CaseResult, type EvalSet, loadSet, readResults, readRunRecord } from "@osolmaz/switch/cli";
import { z } from "zod";
import { loadCase } from "../load.ts";
import { formatReport, type Label, labelSchema, type Report, score, type Verdicts } from "./score.ts";

/** The field that rubric-judge adds to switch's eval set: its labels file, relative to the set file. */
const labelledSchema = z.object({ labels: z.string().min(1) });

/** A switch eval set with rubric-judge's labels file. */
export interface LabelledSet extends EvalSet {
	readonly labels: string;
}

/** Reads an eval set file with its labels file. */
export async function loadLabelledSet(file: string): Promise<LabelledSet> {
	const set = await loadSet(file);
	const { labels } = labelledSchema.parse(JSON.parse(await readFile(file, "utf8")));
	return { ...set, labels: resolve(dirname(resolve(file)), labels) };
}

async function readLabels(path: string): Promise<Label[]> {
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => labelSchema.parse(JSON.parse(line)));
}

/** Each rubric item's category, by `case/item`, from the case folders of the set that have results. */
async function categoriesOf(set: EvalSet, results: readonly CaseResult[]): Promise<Map<string, string>> {
	const ran = new Set(results.map((result) => result.case));
	const folders = set.folders.filter((folder) => ran.has(basename(folder)));
	const loaded = await Promise.all(folders.map((folder) => loadCase(folder)));
	return new Map(
		loaded.flatMap(({ case: judgeCase }) =>
			judgeCase.items.map((item) => [`${judgeCase.id}/${item.id}`, item.category ?? "unknown"] as const),
		),
	);
}

function reportOn(
	results: readonly CaseResult[],
	labels: readonly Label[],
	cases: ReadonlySet<string>,
	categories: ReadonlyMap<string, string>,
): Report {
	const verdicts = new Map<string, Verdicts>(results.map((result) => [result.case, { answers: result.answers }]));
	return score(
		labels.filter((label) => cases.has(label.id)),
		verdicts,
		categories,
	);
}

/** Scores a run against its set's labels on every case the set schedules; a case without answers counts as wrong. */
export async function scoreResults(runFolder: string, set: LabelledSet): Promise<{ report: Report; text: string }> {
	const [results, labels] = await Promise.all([readResults(runFolder), readLabels(set.labels)]);
	const report = reportOn(results, labels, set.ids, await categoriesOf(set, results));
	return { report, text: formatReport(report) };
}

/** One run's line in a comparison. */
export interface ComparedRun {
	readonly run: string;
	/** The run's definition as `name@hash`, with the first 12 characters of the hash. */
	readonly definition: string;
	readonly model: string;
	readonly stateFrom: string | null;
	readonly report: Report;
	/** The requests to the decision model. */
	readonly requests: number | null;
	readonly inputTokens: number | null;
	/** The cost in US dollars at the model's catalog price. */
	readonly cost: number | null;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

function metricsLine({ report, requests, inputTokens, cost: dollars }: ComparedRun): string {
	const item = report.itemMetrics;
	const price = dollars === null ? "-" : `$${dollars.toFixed(4)}`;
	const cost = `${String(requests ?? "-")} requests, ${String(inputTokens ?? "-")} input tokens, ${price}`;
	if (item === null) return `  no answered items; ${cost}`;
	const kappa = item.kappa === null ? "-" : item.kappa.toFixed(2);
	return `  items right ${percent(item.accuracy)}, kappa ${kappa}, false passes ${String(item.falsePasses)}, false fails ${String(item.falseFails)}; ${cost}`;
}

function formatComparison(cases: number, runs: readonly ComparedRun[]): string {
	const lines = [`${String(cases)} cases that every run answered`];
	for (const run of runs) {
		const source = run.stateFrom === null ? "" : `, state of ${run.stateFrom}`;
		lines.push(`${run.run}: ${run.definition}, ${run.model}${source}`, metricsLine(run));
	}
	return lines.join("\n");
}

/**
 * Scores several runs against a set's labels on the same cases: those of the set that every run answered, so that a
 * case one run failed does not count against it.
 */
export async function compareRuns(
	runFolders: readonly string[],
	set: LabelledSet,
): Promise<{ runs: ComparedRun[]; text: string }> {
	const labels = await readLabels(set.labels);
	const loaded = await Promise.all(
		runFolders.map(async (run) => ({ run, record: await readRunRecord(run), results: await readResults(run) })),
	);
	const categories = await categoriesOf(
		set,
		loaded.flatMap(({ results }) => results),
	);
	let common = new Set(set.ids);
	for (const { results } of loaded) {
		const answered = new Set(results.filter((result) => result.answers !== null).map((result) => result.case));
		common = new Set([...common].filter((id) => answered.has(id)));
	}
	const runs = loaded.map(({ run, record, results }) => ({
		run,
		definition: `${record.definition.name}@${record.definition.hash.slice(0, 12)}`,
		model: record.model,
		stateFrom: record.stateFrom,
		report: reportOn(results, labels, common, categories),
		requests: record.totals?.requests ?? null,
		inputTokens: record.totals?.usage.input ?? null,
		cost: record.totals?.usage.cost.total ?? null,
	}));
	return { runs, text: formatComparison(common.size, runs) };
}

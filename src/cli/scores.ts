import { readFile } from "node:fs/promises";
import { formatReport, type Label, labelSchema, type Report, score, type Verdicts } from "../eval/score.ts";
import { type CaseResult, readResults, readRunRecord } from "./runs.ts";
import type { EvalSet } from "./sets.ts";

async function readLabels(path: string): Promise<Label[]> {
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => labelSchema.parse(JSON.parse(line)));
}

function reportOn(results: readonly CaseResult[], labels: readonly Label[], cases: ReadonlySet<string>): Report {
	const verdicts = new Map<string, Verdicts>(results.map((result) => [result.case, { answers: result.answers }]));
	const categories = new Map(
		results.flatMap((result) =>
			Object.entries(result.categories).map(([item, category]) => [`${result.case}/${item}`, category] as const),
		),
	);
	return score(
		labels.filter((label) => cases.has(label.id)),
		verdicts,
		categories,
	);
}

/** Scores a run against its set's labels on every case the set schedules; a case without answers counts as wrong. */
export async function scoreResults(runFolder: string, set: EvalSet): Promise<{ report: Report; text: string }> {
	const report = reportOn(await readResults(runFolder), await readLabels(set.labels), set.ids);
	return { report, text: formatReport(report) };
}

/** One run's line in a comparison. */
export interface ComparedRun {
	readonly run: string;
	/** The run's definition as `name@hash`, with the first 12 characters of the hash. */
	readonly definition: string;
	readonly model: string;
	readonly evidenceFrom: string | null;
	readonly report: Report;
	readonly calls: number | null;
	readonly inputTokens: number | null;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

function metricsLine({ report, calls, inputTokens }: ComparedRun): string {
	const item = report.itemMetrics;
	const cost = `${String(calls ?? "-")} calls, ${String(inputTokens ?? "-")} input tokens`;
	if (item === null) return `  no answered items; ${cost}`;
	const kappa = item.kappa === null ? "-" : item.kappa.toFixed(2);
	return `  items right ${percent(item.accuracy)}, kappa ${kappa}, false passes ${String(item.falsePasses)}, false fails ${String(item.falseFails)}; ${cost}`;
}

function formatComparison(cases: number, runs: readonly ComparedRun[]): string {
	const lines = [`${String(cases)} cases that every run answered`];
	for (const run of runs) {
		const source = run.evidenceFrom === null ? "" : `, evidence of ${run.evidenceFrom}`;
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
	set: EvalSet,
): Promise<{ runs: ComparedRun[]; text: string }> {
	const labels = await readLabels(set.labels);
	const loaded = await Promise.all(
		runFolders.map(async (run) => ({ run, record: await readRunRecord(run), results: await readResults(run) })),
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
		evidenceFrom: record.evidenceFrom,
		report: reportOn(results, labels, common),
		calls: record.totals?.calls ?? null,
		inputTokens: record.totals?.inputTokens ?? null,
	}));
	return { runs, text: formatComparison(common.size, runs) };
}

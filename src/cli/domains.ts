import type { Decider, JsonObject, Limits, RunResult, Trace } from "../core/index.ts";
import { run } from "../core/index.ts";
import { legalJudge, loadJudge } from "../domains/legal-judge/index.ts";
import { ingestCase } from "../domains/legal-judge/ingest/ingest.ts";
import { loadCase } from "../domains/legal-judge/load.ts";

export interface CaseRun {
	readonly case: string;
	readonly result: RunResult;
	/** Each question's category, for reports. */
	readonly categories: Readonly<Record<string, string>>;
}

/** The judge a domain runs, as a run record keeps it: its name, its hash and its whole definition. */
export interface JudgeRecord {
	readonly name: string;
	readonly hash: string;
	readonly definition: JsonObject;
}

/** A domain with its judge, as the command line runs it on case folders. */
export interface DomainEntry {
	readonly name: string;
	readonly version: string;
	readonly judge: JudgeRecord;
	readonly limits: Limits;
	caseId(folder: string): Promise<string>;
	run(folder: string, decider: Decider, limits: Limits, trace: Trace): Promise<CaseRun>;
}

/** Turns an input folder into a case folder, by domain name. */
export const INGESTERS: Readonly<Record<string, (input: string, output: string, id: string) => Promise<void>>> = {
	"legal-judge": async (input, output, id) => {
		await ingestCase(input, output, { id });
	},
};

/** The legal-judge domain with the judge defined in `judgeFile`. */
export async function domainFor(judgeFile: string): Promise<DomainEntry> {
	const judge = await loadJudge(judgeFile);
	const domain = legalJudge(judge);
	return {
		name: domain.name,
		version: domain.version,
		judge: { name: judge.definition.name, hash: judge.hash, definition: judge.definition },
		limits: judge.definition.limits,
		caseId: async (folder) => (await loadCase(folder)).case.id,
		async run(folder, decider, limits, trace) {
			const workspace = await loadCase(folder);
			const result = await run(domain, workspace, decider, { case: workspace.case.id, limits, trace });
			const categories = Object.fromEntries(
				workspace.case.items.map((item) => [item.id, item.category ?? "unknown"]),
			);
			return { case: workspace.case.id, result, categories };
		},
	};
}

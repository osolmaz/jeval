import type { Decider, Limits, RunResult, Trace } from "../core/index.ts";
import { run } from "../core/index.ts";
import { legalJudge } from "../domains/legal-judge/index.ts";
import { ingestCase } from "../domains/legal-judge/ingest/ingest.ts";
import { loadCase } from "../domains/legal-judge/load.ts";

export interface CaseRun {
	readonly case: string;
	readonly result: RunResult;
	/** Each question's category, for reports. */
	readonly categories: Readonly<Record<string, string>>;
}

/** A domain as the command line uses it: run it on a case folder, and make case folders from input folders. */
export interface DomainEntry {
	readonly name: string;
	readonly version: string;
	caseId(folder: string): Promise<string>;
	run(folder: string, decider: Decider, limits: Limits, trace: Trace): Promise<CaseRun>;
	ingest(input: string, output: string, id: string): Promise<void>;
}

const legalJudgeEntry: DomainEntry = {
	name: legalJudge.name,
	version: legalJudge.version,
	caseId: async (folder) => (await loadCase(folder)).case.id,
	async run(folder, decider, limits, trace) {
		const workspace = await loadCase(folder);
		const result = await run(legalJudge, workspace, decider, { case: workspace.case.id, limits, trace });
		const categories = Object.fromEntries(workspace.case.items.map((item) => [item.id, item.category ?? "unknown"]));
		return { case: workspace.case.id, result, categories };
	},
	async ingest(input, output, id) {
		await ingestCase(input, output, { id });
	},
};

export const DOMAINS: Readonly<Record<string, DomainEntry>> = { [legalJudgeEntry.name]: legalJudgeEntry };

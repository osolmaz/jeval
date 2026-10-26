import { createHash } from "node:crypto";
import type { Decider, JsonObject, Limits, RunResult, Trace } from "../core/index.ts";
import { run, STOP_KEY } from "../core/index.ts";
import { chess, LIMITS as CHESS_LIMITS, outcomeOf } from "../domains/chess/index.ts";
import { loadCase as loadChessCase } from "../domains/chess/load.ts";
import { DEFAULT_JUDGE, legalJudge, loadJudge } from "../domains/legal-judge/index.ts";
import { ingestCase } from "../domains/legal-judge/ingest/ingest.ts";
import { loadCase } from "../domains/legal-judge/load.ts";

export interface CaseRun {
	readonly case: string;
	readonly result: RunResult;
	/** Each question's category, for reports. */
	readonly categories: Readonly<Record<string, string>>;
	/** How the case ended in the domain's own terms, such as a game's result; null when the domain reports none. */
	readonly outcome: JsonObject | null;
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

/** The command line was asked for a domain it does not know, or for a judge file the domain does not take. */
export class DomainError extends Error {
	override readonly name = "DomainError";
}

/** The legal-judge domain with the judge defined in `judgeFile`, or the default judge. */
async function legalJudgeEntry(judgeFile: string | undefined): Promise<DomainEntry> {
	const judge = await loadJudge(judgeFile ?? DEFAULT_JUDGE);
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
			return { case: workspace.case.id, result, categories, outcome: null };
		},
	};
}

/** The chess domain. Its texts and limits stand in for a judge, so a run records them with their hash. */
function chessEntry(judgeFile: string | undefined): Promise<DomainEntry> {
	if (judgeFile !== undefined) return Promise.reject(new DomainError("the chess domain takes no judge file"));
	const definition = { stop: chess.stop, choose: chess.choose, limits: { ...CHESS_LIMITS } };
	const hash = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
	return Promise.resolve({
		name: chess.name,
		version: chess.version,
		judge: { name: chess.name, hash, definition },
		limits: CHESS_LIMITS,
		caseId: async (folder) => (await loadChessCase(folder)).id,
		async run(folder, decider, limits, trace) {
			const game = await loadChessCase(folder);
			const result = await run(chess, game, decider, { case: game.id, limits, trace });
			const last = result.trace.entries.findLast((entry) => entry.type === "choice");
			const resigned = last?.type === "choice" && last.key === STOP_KEY;
			return { case: game.id, result, categories: {}, outcome: outcomeOf(game, result.log, resigned) };
		},
	});
}

const DOMAINS: Readonly<Record<string, (judgeFile: string | undefined) => Promise<DomainEntry>>> = {
	"legal-judge": legalJudgeEntry,
	chess: chessEntry,
};

/** A domain by name, ready for the command line to run; `judgeFile` is for the domains that take a judge. */
export async function domainNamed(name: string, judgeFile?: string): Promise<DomainEntry> {
	const entry = DOMAINS[name];
	if (entry === undefined) throw new DomainError(`no domain ${name}; known: ${Object.keys(DOMAINS).join(", ")}`);
	return entry(judgeFile);
}

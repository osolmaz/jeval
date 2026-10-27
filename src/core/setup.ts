import { createHash } from "node:crypto";
import { run, type RunResult } from "./loop.ts";
import type { Replay } from "./replay.ts";
import type { Trace } from "./trace.ts";
import type { Decider, Domain, JsonObject, Limits } from "./types.ts";

/** Every text a domain gives the model that does not come from a case, and its limits: what a run records. */
export interface Definition {
	readonly name: string;
	/** The SHA-256 of `content` as JSON, so formatting does not count. */
	readonly hash: string;
	readonly content: JsonObject;
}

/** The SHA-256 of a value as JSON, in hex. */
export const hashOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const definitionOf = (name: string, content: JsonObject): Definition => ({
	name,
	hash: hashOf(content),
	content,
});

/** A domain with what a program needs to run it on case folders. */
export interface Setup<W> {
	readonly domain: Domain<W>;
	readonly definition: Definition;
	readonly limits: Limits;
	/** The case id in a case folder, read without loading the whole case. */
	caseId(folder: string): Promise<string>;
	/** The world of a case folder. */
	load(folder: string): Promise<W>;
	/** How the case ended in the domain's own terms, such as a game's result; none when it is missing. */
	outcome?(world: W, result: RunResult): JsonObject;
}

/** One case run from its folder: its id, the loop's result and how the case ended. */
export interface CaseRun {
	readonly case: string;
	readonly result: RunResult;
	/** Null when the domain reports no outcome. */
	readonly outcome: JsonObject | null;
}

export interface CaseOptions {
	readonly limits: Limits;
	readonly trace: Trace;
	/** A trace whose observations the case takes again, up to a fork. */
	readonly replay?: Replay;
}

/** A domain's setup without its world type, so that a program can keep the setups of different domains together. */
export interface Runner {
	readonly name: string;
	readonly version: string;
	readonly definition: Definition;
	readonly limits: Limits;
	caseId(folder: string): Promise<string>;
	run(folder: string, decider: Decider, options: CaseOptions): Promise<CaseRun>;
}

/** A domain was asked to set up with a definition that it does not take. */
export class SetupError extends Error {
	override readonly name = "SetupError";
}

/** The runner of a setup: it loads a case folder, runs the loop on it and reports the case. */
export function runnerOf<W>(setup: Setup<W>): Runner {
	const { domain } = setup;
	return {
		name: domain.name,
		version: domain.version,
		definition: setup.definition,
		limits: setup.limits,
		caseId: (folder) => setup.caseId(folder),
		async run(folder, decider, options) {
			const id = await setup.caseId(folder);
			const world = await setup.load(folder);
			const result = await run(domain, world, decider, { case: id, ...options });
			return { case: id, result, outcome: setup.outcome?.(world, result) ?? null };
		},
	};
}

import { createHash } from "node:crypto";
import { run } from "./loop.ts";
import type { Replay } from "./replay.ts";
import type { Trace } from "./trace.ts";
import type { Choice, Decider, Definition, Domain, JsonObject, Limits, RunResult } from "./types.ts";

/** The SHA-256 of a value as JSON, in hex. */
export const hashOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const definitionOf = (name: string, content: JsonObject): Definition => ({
	name,
	hash: hashOf(content),
	content,
});

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
	/** A trace whose picks and states the case takes again. */
	readonly replay?: Replay;
}

/** A domain without its state type, so that a program can keep domains of different state types together. */
export interface Runner {
	readonly name: string;
	readonly version: string;
	readonly definition: Definition;
	readonly limits: Limits;
	caseId(folder: string): Promise<string>;
	run(folder: string, decider: Decider, options: CaseOptions): Promise<CaseRun>;
}

/**
 * The runner of a domain: it loads a case folder's state machine, runs the loop on it and reports the case. A domain
 * without a definition of its own is defined by its stop text, its instructions and its limits.
 */
export function runnerOf<S extends JsonObject, C extends Choice>(domain: Domain<S, C>): Runner {
	const { name, stop, instructions, limits } = domain;
	return {
		name,
		version: domain.version,
		definition: domain.definition ?? definitionOf(name, { stop, instructions, limits: { ...limits } }),
		limits,
		caseId: (folder) => domain.caseId(folder),
		async run(folder, decider, options) {
			const id = await domain.caseId(folder);
			const machine = await domain.load(folder);
			const result = await run(domain, machine, decider, options);
			return { case: id, result, outcome: domain.outcome?.(result.state, result) ?? null };
		},
	};
}

import { definitionFor } from "./definition.ts";
import { run } from "./loop.ts";
import type { Replay } from "./replay.ts";
import type { Trace } from "./trace.ts";
import type { Decider, Definition, Domain, JsonObject, Limits, RunResult } from "./types.ts";

/** One case run from its folder: its id, the loop's result and how the case ended. */
export interface CaseRun {
	readonly case: string;
	readonly result: RunResult;
	/** Null when the domain reports no outcome. */
	readonly outcome: JsonObject | null;
}

export interface CaseOptions {
	readonly trace: Trace;
	/** A trace whose answers and states the case takes again, under its limits. */
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
 * without a definition of its own is defined by its limits.
 */
export function runnerOf<S extends JsonObject>(domain: Domain<S>): Runner {
	const definition = definitionFor(domain);
	return {
		name: domain.name,
		version: domain.version,
		definition,
		limits: domain.limits,
		caseId: (folder) => domain.caseId(folder),
		async run(folder, decider, options) {
			const id = await domain.caseId(folder);
			const machine = await domain.load(folder);
			const result = await run({ ...domain, definition }, machine, decider, { ...options, case: id });
			return { case: id, result, outcome: domain.outcome?.(result) ?? null };
		},
	};
}

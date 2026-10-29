import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { decisionUsageSchema, endingSchema, limitsSchema } from "../core/index.ts";
import { caseFiles, casesFolder, runFile } from "./layout.ts";

/** What a harness's `run` and `replay --out` write as each case's `result.json`. */
export const resultSchema = z.object({
	case: z.string(),
	domain: z.string(),
	version: z.string(),
	model: z.string(),
	steps: z.number().int(),
	/** Why the run ended; null when the case threw before it ended. */
	ended: endingSchema.nullable(),
	/** Why the run failed; null when it did not, or when the case threw before it ended. */
	error: z.string().nullable(),
	/** How the case ended in the domain's own terms; null when the domain reports none, or when the case threw. */
	outcome: z.record(z.string(), z.unknown()).nullable(),
	/**
	 * The error that stopped the case, from its code or from switch, such as a replay that does not match; null when
	 * none did. A run that goes on runs such a case again.
	 */
	thrown: z.string().nullable(),
});
export type CaseResult = z.infer<typeof resultSchema>;

/** A case failed: it threw, or its run failed. */
export const failed = (result: CaseResult): boolean => result.thrown !== null || result.ended === "failed";

/**
 * What a harness's `run` and `replay --out` write as `run.json`: what ran, with which definition and model, on which
 * code, from which trace if any, and at the end its totals.
 */
export const runRecordSchema = z.object({
	domain: z.string(),
	version: z.string(),
	definition: z.object({ name: z.string(), hash: z.string(), content: z.record(z.string(), z.unknown()) }),
	model: z.string(),
	/** The limits that the cases ran under: the domain's, or those of the trace that a replay repeats. */
	limits: limitsSchema,
	switch: z.object({ version: z.string(), commit: z.string().nullable(), changed: z.boolean().nullable() }),
	set: z.object({ name: z.string(), file: z.string() }).nullable(),
	/** The trace that a replay repeats, and the step of its fork. */
	replay: z.object({ trace: z.string(), fork: z.number().int().nullable() }).nullable(),
	started: z.string(),
	finished: z.string().nullable(),
	totals: z
		.object({
			cases: z.number().int(),
			failed: z.number().int(),
			/** The requests to the decision model, and the sum of their usage. */
			requests: z.number().int(),
			usage: decisionUsageSchema,
		})
		.nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export async function exists(path: string): Promise<boolean> {
	return readFile(path).then(
		() => true,
		() => false,
	);
}

export async function readRunRecord(out: string): Promise<RunRecord> {
	return runRecordSchema.parse(JSON.parse(await readFile(runFile(out), "utf8")));
}

/** A case's result, or null when the case has none yet. */
export async function readResult(out: string, id: string): Promise<CaseResult | null> {
	const path = caseFiles(out, id).result;
	if (!(await exists(path))) return null;
	return resultSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** The results of every case of a run that has one. */
export async function readResults(out: string): Promise<CaseResult[]> {
	const ids = (await readdir(casesFolder(out))).sort();
	const results: CaseResult[] = [];
	for (const id of ids) {
		const result = await readResult(out, id);
		if (result !== null) results.push(result);
	}
	return results;
}

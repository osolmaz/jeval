import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { answerSchema } from "../core/index.ts";
import { caseFiles, casesFolder, runFile } from "./layout.ts";

/** What `jeval run` writes as each case's `result.json`. */
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

/**
 * What `jeval run` writes as `run.json`: what ran, with which judge and model, on which code, from which earlier run's
 * evidence if any, and at the end its totals.
 */
export const runRecordSchema = z.object({
	domain: z.string(),
	version: z.string(),
	judge: z.object({ name: z.string(), hash: z.string(), definition: z.record(z.string(), z.unknown()) }),
	model: z.string(),
	limits: z.object({ steps: z.number().int(), options: z.number().int(), windowShare: z.number() }),
	jeval: z.object({ version: z.string(), commit: z.string().nullable(), changed: z.boolean().nullable() }),
	set: z.object({ name: z.string(), file: z.string() }).nullable(),
	evidenceFrom: z.string().nullable(),
	started: z.string(),
	finished: z.string().nullable(),
	totals: z
		.object({
			cases: z.number().int(),
			failed: z.number().int(),
			calls: z.number().int(),
			inputTokens: z.number().int(),
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

/** The results of every case of a run that has finished. */
export async function readResults(out: string): Promise<CaseResult[]> {
	const ids = (await readdir(casesFolder(out))).sort();
	const results: CaseResult[] = [];
	for (const id of ids) {
		const path = caseFiles(out, id).result;
		if (await exists(path)) results.push(resultSchema.parse(JSON.parse(await readFile(path, "utf8"))));
	}
	return results;
}

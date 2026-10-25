import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where a run keeps everything: `run.json` at the top, then one folder per case with its result, its trace and the
 * requests sent for it.
 */
export const runFile = (out: string): string => join(out, "run.json");
export const casesFolder = (out: string): string => join(out, "cases");

export interface CaseFiles {
	readonly folder: string;
	/** The case's answers and outcome. */
	readonly result: string;
	/** Every menu, choice, observation and answer, in order. */
	readonly trace: string;
	/** Every request sent to the decision model for the case, as sent, with its result. */
	readonly requests: string;
}

export function caseFiles(out: string, id: string): CaseFiles {
	const folder = join(casesFolder(out), id);
	return {
		folder,
		result: join(folder, "result.json"),
		trace: join(folder, "trace.jsonl"),
		requests: join(folder, "requests.jsonl"),
	};
}

/** A JSON Lines file written from the start: each line is appended after the one before, so the order holds. */
export async function jsonLines(path: string): Promise<{ add(value: unknown): void; done(): Promise<void> }> {
	await writeFile(path, "");
	let written = Promise.resolve();
	return {
		add(value) {
			written = written.then(() => appendFile(path, `${JSON.stringify(value)}\n`));
		},
		done: () => written,
	};
}

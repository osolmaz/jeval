import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

/**
 * An eval set: a name, the folder of its case folders, relative to the set file, and the ids of the cases it
 * schedules. A harness may add fields of its own, such as legal-judge's labels file. Sets live with their private
 * data, not in this repository.
 */
export const setSchema = z.object({
	name: z.string().min(1),
	cases: z.string().min(1),
	ids: z.array(z.string().min(1)).min(1),
});

export interface EvalSet {
	readonly name: string;
	readonly file: string;
	/** Each scheduled case's folder, in the set's order. */
	readonly folders: readonly string[];
	readonly ids: ReadonlySet<string>;
}

export async function loadSet(file: string): Promise<EvalSet> {
	const set = setSchema.parse(JSON.parse(await readFile(file, "utf8")));
	const root = dirname(resolve(file));
	return {
		name: set.name,
		file,
		folders: set.ids.map((id) => resolve(root, set.cases, id)),
		ids: new Set(set.ids),
	};
}

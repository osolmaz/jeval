import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** A race: its id, the article it starts at and the article it must reach, by their Wikipedia titles. */
export const caseSchema = z
	.object({
		id: z.string().min(1),
		start: z.string().min(1),
		target: z.string().min(1),
	})
	.strict();
export type Race = z.infer<typeof caseSchema>;

/** Reads and checks a case folder's `case.json`. */
export async function loadRace(folder: string): Promise<Race> {
	return caseSchema.parse(JSON.parse(await readFile(join(folder, "case.json"), "utf8")));
}

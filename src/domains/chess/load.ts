import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChessCase, caseSchema } from "./case.ts";

/** Reads and checks a case folder's `case.json`. */
export async function loadCase(folder: string): Promise<ChessCase> {
	return caseSchema.parse(JSON.parse(await readFile(join(folder, "case.json"), "utf8")));
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DefinitionError, definitionOf, type Runner, runnerOf } from "@osolmaz/switch";
import { FACTS, factsMachine } from "./fakes.ts";

const caseSchema = z.object({ id: z.string(), facts: z.record(z.string(), z.string()) });
const readCase = async (folder: string) =>
	caseSchema.parse(JSON.parse(await readFile(join(folder, "facts.json"), "utf8")));

/** A case folder of the test domain under `root`: its id and its facts in `facts.json`. */
export async function factsFolder(
	root: string,
	id: string,
	facts: Readonly<Record<string, string>> = { a: "fact a", b: "fact b" },
): Promise<string> {
	const folder = join(root, "cases", id);
	await mkdir(folder, { recursive: true });
	await writeFile(join(folder, "facts.json"), JSON.stringify({ id, facts }));
	return folder;
}

/** The test domain: it takes no definition file, and a case's outcome says how the steps ended. */
export function factsSetup(file: string | undefined): Promise<Runner> {
	if (file !== undefined) return Promise.reject(new DefinitionError("the facts domain takes no definition file"));
	return Promise.resolve(
		runnerOf({
			...FACTS,
			definition: definitionOf("facts", { stop: FACTS.stop, instructions: FACTS.instructions }),
			caseId: async (folder) => (await readCase(folder)).id,
			load: async (folder) => factsMachine({ facts: (await readCase(folder)).facts }),
			outcome: (state, result) => ({ result: "answered", reason: result.ended, looked: state.looked.length }),
		}),
	);
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { caseSchema } from "./case.ts";
import { makeWorld, type World } from "./world.ts";

/** Reads and checks a case folder's `case.json`; images are read from the folder when a step looks at them. */
export async function loadCase(folder: string): Promise<World> {
	const legalCase = caseSchema.parse(JSON.parse(await readFile(join(folder, "case.json"), "utf8")));
	return makeWorld(legalCase, async (render) => ({
		label: render.label,
		mimeType: render.mimeType,
		data: (await readFile(join(folder, render.path))).toString("base64"),
	}));
}

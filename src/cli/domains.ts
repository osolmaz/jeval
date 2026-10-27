import type { Runner } from "../core/index.ts";
import { chessSetup } from "../domains/chess/setup.ts";
import { ingestCase } from "../domains/legal-judge/ingest/ingest.ts";
import { legalJudgeSetup } from "../domains/legal-judge/setup.ts";

/** Turns an input folder into a case folder, by domain name. */
export const INGESTERS: Readonly<Record<string, (input: string, output: string, id: string) => Promise<void>>> = {
	"legal-judge": async (input, output, id) => {
		await ingestCase(input, output, { id });
	},
};

/** The command line was asked for a domain it does not know. */
export class DomainError extends Error {
	override readonly name = "DomainError";
}

/** Each domain's setup by name: it makes the domain's runner from a definition file, or from its own definition. */
const DOMAINS: Readonly<Record<string, (definitionFile: string | undefined) => Promise<Runner>>> = {
	"legal-judge": legalJudgeSetup,
	chess: chessSetup,
};

/** A domain by name, ready to run, with the definition in `definitionFile` or with the domain's own. */
export async function domainNamed(name: string, definitionFile?: string): Promise<Runner> {
	const setup = DOMAINS[name];
	if (setup === undefined) throw new DomainError(`no domain ${name}; known: ${Object.keys(DOMAINS).join(", ")}`);
	return setup(definitionFile);
}

import type { Runner } from "../core/index.ts";
import { chessSetup } from "../domains/chess/setup.ts";
import { chessViewer } from "../domains/chess/viewer.ts";
import { ingestCase } from "../domains/legal-judge/ingest/ingest.ts";
import { legalJudgeSetup } from "../domains/legal-judge/setup.ts";
import type { DomainViewer } from "../view/index.ts";

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

/** A domain on the command line: its setup, and its part of the viewer when it has one. */
interface Entry {
	/** Makes the domain's runner from a definition file, or from its own definition. */
	readonly setup: (definitionFile: string | undefined) => Promise<Runner>;
	readonly viewer?: DomainViewer;
}

/** Each domain by name. */
const DOMAINS: Readonly<Record<string, Entry>> = {
	"legal-judge": { setup: legalJudgeSetup },
	chess: { setup: chessSetup, viewer: chessViewer },
};

/** A domain by name, ready to run, with the definition in `definitionFile` or with the domain's own. */
export async function domainNamed(name: string, definitionFile?: string): Promise<Runner> {
	const entry = DOMAINS[name];
	if (entry === undefined) throw new DomainError(`no domain ${name}; known: ${Object.keys(DOMAINS).join(", ")}`);
	return entry.setup(definitionFile);
}

/** The part of the viewer of each domain that has one, by the domain's name. */
export const VIEWERS: Readonly<Record<string, DomainViewer>> = Object.fromEntries(
	Object.entries(DOMAINS).flatMap(([name, entry]) => (entry.viewer === undefined ? [] : [[name, entry.viewer]])),
);

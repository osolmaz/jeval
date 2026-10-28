import type { Json, JsonObject, View } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "./case.ts";
import type { JudgeDefinition } from "./definition.ts";
import { type CaseFolder, type LegalState, LIMITS, readParts } from "./state.ts";

const size = (value: Json): number => Math.ceil(JSON.stringify(value).length / LIMITS.charsPerToken);

function readStatus(file: CaseFile, read: ReadonlySet<number> | undefined): string {
	if (read === undefined || read.size === 0) return "no";
	return read.size >= file.units.length ? "all" : `${String(read.size)} of ${String(file.units.length)} parts`;
}

/** What the model reads for a pick: the rubric, the files and what has been read of them, and the steps so far. */
function pickJson(legalCase: LegalCase, state: LegalState, texts: JudgeDefinition["texts"]): JsonObject {
	const read = readParts(state);
	return {
		process: texts.process,
		stage: texts.gather,
		request: legalCase.request,
		rubric: legalCase.items.map((item) => ({ id: item.id, criterion: item.text })),
		files: legalCase.files.map((file) => ({
			path: file.path,
			role: file.role,
			kind: file.kind,
			words: file.words,
			read: readStatus(file, read.get(file.id)),
		})),
		steps_taken: state.evidence.map((entry) => entry.source),
	};
}

interface Evidence {
	readonly source: string;
	readonly text: string;
}

/** Cuts the longest evidence first until the evidence fits `room` tokens, and says what it cut. */
export function fitEvidence(evidence: readonly Evidence[], room: number): { evidence: Evidence[]; omitted: string[] } {
	const over = size(evidence.map(({ source, text }) => ({ source, text }))) - room;
	if (over <= 0) return { evidence: [...evidence], omitted: [] };
	let excess = over * LIMITS.charsPerToken;
	const cuts = new Map<number, number>();
	const longest = evidence
		.map((entry, index) => ({ index, length: entry.text.length }))
		.sort((a, b) => b.length - a.length);
	for (const { index, length } of longest) {
		if (excess <= 0) break;
		const cut = Math.min(length, excess + 80);
		cuts.set(index, cut);
		excess -= cut;
	}
	const omitted: string[] = [];
	const fitted = evidence.map((entry, index) => {
		const cut = cuts.get(index);
		if (cut === undefined) return entry;
		omitted.push(`${String(cut)} characters of ${entry.source}`);
		const kept = entry.text.slice(0, Math.max(0, entry.text.length - cut));
		return { source: entry.source, text: `${kept}\n[cut: ${String(cut)} characters left out to fit the window]` };
	});
	return { evidence: fitted, omitted };
}

/**
 * What the model reads in a state: for a pick, the rubric and the files as well; for the answers, the evidence. The
 * images that the evidence names are loaded from the case folder.
 */
export async function view(
	texts: JudgeDefinition["texts"],
	folder: CaseFolder,
	state: LegalState,
	purpose: "choose" | "answer",
	tokens: number,
): Promise<View> {
	const base = purpose === "choose" ? pickJson(folder.case, state, texts) : { request: folder.case.request };
	const fitted = fitEvidence(state.evidence, tokens - size(base));
	const renders = state.evidence.flatMap((entry) => (entry.image === undefined ? [] : [entry.image]));
	return {
		json: { ...base, evidence: fitted.evidence.map(({ source, text }) => ({ source, text })) },
		images: await Promise.all(renders.map((render) => folder.image(render))),
		omitted: fitted.omitted,
	};
}

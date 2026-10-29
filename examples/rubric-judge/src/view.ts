import { estimateTokens, type JsonObject, type View } from "@osolmaz/switch";
import type { CaseFile, JudgeCase } from "./case.ts";
import type { JudgeDefinition } from "./definition.ts";
import { type CaseFolder, type JudgeState, readParts } from "./state.ts";

function readStatus(file: CaseFile, read: ReadonlySet<number> | undefined): string {
	if (read === undefined || read.size === 0) return "no";
	return read.size >= file.units.length ? "all" : `${String(read.size)} of ${String(file.units.length)} parts`;
}

/** What the model reads for a pick: the rubric, the files and what has been read of them, and the steps so far. */
function pickJson(judgeCase: JudgeCase, state: JudgeState, texts: JudgeDefinition["texts"]): JsonObject {
	const read = readParts(state);
	return {
		process: texts.process,
		stage: texts.gather,
		request: judgeCase.request,
		rubric: judgeCase.items.map((item) => ({ id: item.id, criterion: item.text })),
		files: judgeCase.files.map((file) => ({
			path: file.path,
			role: file.role,
			format: file.format,
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

/**
 * Cuts the longest evidence first until the evidence fits `room` tokens at `charsPerToken`. A cut text ends with a
 * note that says how much it lost, so the model knows.
 */
export function fitEvidence(evidence: readonly Evidence[], room: number, charsPerToken: number): Evidence[] {
	const over =
		estimateTokens(
			evidence.map(({ source, text }) => ({ source, text })),
			charsPerToken,
		) - room;
	if (over <= 0) return [...evidence];
	let excess = over * charsPerToken;
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
	return evidence.map((entry, index) => {
		const cut = cuts.get(index);
		if (cut === undefined) return entry;
		const kept = entry.text.slice(0, Math.max(0, entry.text.length - cut));
		return { source: entry.source, text: `${kept}\n[cut: ${String(cut)} characters left out to fit the window]` };
	});
}

/** What the model reads for the checks besides the evidence: the process, the checking stage and the rules. */
const checkTexts = ({ process, check, rules }: JudgeDefinition["texts"]): JsonObject => ({
	process,
	stage: check,
	rules,
});

/**
 * What the model reads in a state: while it gathers, the rubric and the files as well; for the checks, the evidence
 * with the checking stage and the rules. The images that the evidence names are loaded from the case folder.
 */
export async function view(
	texts: JudgeDefinition["texts"],
	folder: CaseFolder,
	state: JudgeState,
	checking: boolean,
	tokens: number,
	charsPerToken: number,
): Promise<View> {
	const base = checking ? { request: folder.case.request } : pickJson(folder.case, state, texts);
	const after = checking ? checkTexts(texts) : {};
	const room = tokens - estimateTokens({ ...base, ...after }, charsPerToken);
	const fitted = fitEvidence(state.evidence, room, charsPerToken);
	const renders = state.evidence.flatMap((entry) => (entry.image === undefined ? [] : [entry.image]));
	const decisionState = { ...base, evidence: fitted.map(({ source, text }) => ({ source, text })), ...after };
	if (renders.length === 0) return { decisionState };
	return { decisionState, decisionImages: await Promise.all(renders.map((render) => folder.image(render))) };
}

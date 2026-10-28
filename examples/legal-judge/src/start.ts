import { typedKey } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "./case.ts";
import { lookedAt } from "./choices/look.ts";
import { type Evidence, SIZES, type LegalState, partKey, partSource, partText, TYPES, unreadParts } from "./state.ts";

/** The answer's parts read at the start, as the read choices would read them, so that those are left out. */
function readAnswerFile(file: CaseFile, room: number): { evidence: Evidence[]; tokens: number } {
	const evidence: Evidence[] = [];
	let tokens = 0;
	for (const part of unreadParts(file, new Set())) {
		if (tokens + part.tokens > room) break;
		evidence.push({ key: typedKey(TYPES.read, partKey(part)), source: partSource(part), text: partText(part) });
		tokens += part.tokens;
	}
	return { evidence, tokens };
}

const unreadable = (file: CaseFile): Evidence => ({
	key: `unreadable:${file.id}`,
	source: file.path,
	text: `[the file could not be read: ${file.error ?? "unknown error"}]`,
});

const formatting = (file: CaseFile): Evidence => ({
	key: typedKey(TYPES.changes, file.id),
	source: `${file.path}: formatting`,
	text: file.formatting ?? "",
});

/**
 * The initial state: the answer's files, read before the first pick. Their text up to a budget, their images and
 * their Word formatting.
 */
export function openAnswer(legalCase: LegalCase): LegalState {
	const evidence: Evidence[] = [];
	let room = SIZES.answerTokens;
	for (const file of legalCase.files.filter((candidate) => candidate.role === "answer")) {
		if (file.error !== null) {
			evidence.push(unreadable(file));
		} else if (file.format === "image") {
			const seen = evidence.filter((entry) => entry.image !== undefined).length;
			const renders = file.renders.slice(0, Math.max(0, SIZES.images - seen));
			evidence.push(...renders.map((render, index) => lookedAt(file, render, index)));
		} else {
			const opened = readAnswerFile(file, room);
			evidence.push(...opened.evidence);
			room -= opened.tokens;
			if (file.formatting !== null) evidence.push(formatting(file));
		}
	}
	return { evidence };
}

import { choiceType } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "../case.ts";
import { found, type LegalState, withEvidence } from "../state.ts";

const SHOWN = 60;
const basename = (path: string): string => (path.split("/").at(-1) ?? path).toLowerCase();
const paragraphs = (file: CaseFile): string[] =>
	file.units
		.flatMap((unit) => unit.text.split("\n"))
		.map((line) => line.replace(/^P\d+(?: \[[^\]]*\])?: /, "").trim())
		.filter(Boolean);

/** The paragraphs of an edited Word file that are not in the original, and the original's that are gone. */
export function compareFiles(edited: CaseFile, original: CaseFile): string {
	const after = paragraphs(edited);
	const before = paragraphs(original);
	const kept = new Set(before);
	const remaining = new Set(after);
	const added = after.filter((line) => !kept.has(line));
	const removed = before.filter((line) => !remaining.has(line));
	return [
		`${String(added.length)} paragraphs in the answer are not in the original; ${String(removed.length)} paragraphs of the original are not in the answer.`,
		...added.slice(0, SHOWN).map((line) => `+ ${line}`),
		...removed.slice(0, SHOWN).map((line) => `- ${line}`),
	].join("\n");
}

interface Pair {
	readonly edited: CaseFile;
	readonly original: CaseFile;
}

/** The task's document with the same name as an answer's Word file. */
const originalOf = (files: readonly CaseFile[], edited: CaseFile): CaseFile | undefined =>
	files.find(
		(file) => file.role === "document" && file.kind === "docx" && basename(file.path) === basename(edited.path),
	);

/** Compare the answer's Word file with the task's document of the same name, once. */
export const compare = (legalCase: LegalCase) =>
	choiceType<LegalState, Pair>({
		type: "compare",
		choices: (state) =>
			legalCase.files
				.filter((file) => file.role === "answer" && file.kind === "docx" && !found(state, `compare:${file.id}`))
				.flatMap((edited) => {
					const original = originalOf(legalCase.files, edited);
					if (original === undefined) return [];
					const text = `Compare ${edited.path} with the original ${original.path}, paragraph by paragraph`;
					return [{ key: edited.id, text, arg: { edited, original } }];
				}),
		transition: (state, { edited, original }) =>
			withEvidence(state, {
				key: `compare:${edited.id}`,
				source: `${edited.path} compared with ${original.path}`,
				text: compareFiles(edited, original),
			}),
	});

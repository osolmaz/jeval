import { choiceType, typedKey } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "../case.ts";
import { found, type LegalState, TYPES, withEvidence } from "../state.ts";

/** The tracked changes and comments of a Word file, without its list of formatted text. */
export const trackedChanges = (file: CaseFile): string =>
	(file.formatting ?? "").split("\nRuns with direct formatting")[0] ?? "";

/** List the tracked changes and comments of a document that has any. The answer's own are read at the start. */
export const changes = (legalCase: LegalCase) =>
	choiceType<LegalState, CaseFile>({
		type: TYPES.changes,
		choices: (state) =>
			legalCase.files
				.filter((file) => file.role === "document" && file.format === "docx" && file.marks > 0)
				.filter((file) => !found(state, typedKey(TYPES.changes, file.id)))
				.map((file) => ({
					key: file.id,
					text: `List the tracked changes and comments in ${file.path}`,
					arg: file,
				})),
		transition: (state, file, key) =>
			withEvidence(state, {
				key,
				source: `${file.path}: tracked changes and comments`,
				text: trackedChanges(file),
			}),
	});

import { action } from "../../../core/index.ts";
import type { CaseFile } from "../case.ts";
import type { Workspace } from "../workspace.ts";

/** The tracked changes and comments of a Word file, without its list of formatted text. */
export const trackedChanges = (file: CaseFile): string =>
	(file.formatting ?? "").split("\nRuns with direct formatting")[0] ?? "";

/** List the tracked changes and comments of a document that has any. The answer's own are read at the start. */
export const changes = action<Workspace, CaseFile>({
	name: "changes",
	options: (state) =>
		state.workspace.case.files
			.filter((file) => file.role === "document" && file.kind === "docx" && file.marks > 0)
			.map((file) => ({ key: file.id, text: `List the tracked changes and comments in ${file.path}`, arg: file })),
	observe: (_, file) => ({ source: `${file.path}: tracked changes and comments`, text: trackedChanges(file) }),
});

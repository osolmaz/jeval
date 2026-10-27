import { choiceKind } from "@osolmaz/switch";
import type { CaseFile } from "../case.ts";
import type { World } from "../world.ts";

/** The tracked changes and comments of a Word file, without its list of formatted text. */
export const trackedChanges = (file: CaseFile): string =>
	(file.formatting ?? "").split("\nRuns with direct formatting")[0] ?? "";

/** List the tracked changes and comments of a document that has any. The answer's own are read at the start. */
export const changes = choiceKind<World, CaseFile>({
	name: "changes",
	menu: (world) =>
		world.case.files
			.filter((file) => file.role === "document" && file.kind === "docx" && file.marks > 0)
			.map((file) => ({ key: file.id, text: `List the tracked changes and comments in ${file.path}`, arg: file })),
	run: (_, file) => ({ source: `${file.path}: tracked changes and comments`, text: trackedChanges(file) }),
});

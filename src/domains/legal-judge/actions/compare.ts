import { action } from "../../../core/index.ts";
import type { CaseFile } from "../case.ts";
import type { Workspace } from "../workspace.ts";

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

/** Compare the answer's Word file with the task's document of the same name. */
export const compare = action<Workspace, Pair>({
	name: "compare",
	options(state) {
		const files = state.workspace.case.files;
		return files
			.filter((file) => file.role === "answer" && file.kind === "docx")
			.flatMap((edited) => {
				const original = files.find(
					(file) =>
						file.role === "document" && file.kind === "docx" && basename(file.path) === basename(edited.path),
				);
				if (original === undefined) return [];
				const text = `Compare ${edited.path} with the original ${original.path}, paragraph by paragraph`;
				return [{ key: edited.id, text, arg: { edited, original } }];
			});
	},
	observe: (_, { edited, original }) => ({
		source: `${edited.path} compared with ${original.path}`,
		text: compareFiles(edited, original),
	}),
});

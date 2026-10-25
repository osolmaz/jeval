import { action } from "../../../core/index.ts";
import type { CaseFile } from "../case.ts";
import type { Workspace } from "../workspace.ts";

const LENGTH = /\bwords?\b|word count|length|\bpages?\b|sentences?|concise/i;
const HEADING = /^(#{1,6}\s+.+|\*\*[^*]{2,80}\*\*\s*$|P\d+ \[Heading[^\]]*\]: .+)$/;

const wordsIn = (line: string): number => line.split(/\s+/).filter(Boolean).length;

/** A file's words in total and under each heading. */
export function countWords(file: CaseFile): string {
	const lines = file.units.flatMap((unit) => unit.text.split("\n"));
	const out = [`${file.path}: ${String(file.words)} words in total.`];
	let heading = "(before the first heading)";
	let words = 0;
	const flush = () => {
		if (words > 0) out.push(`  ${heading}: ${String(words)} words`);
	};
	for (const line of lines) {
		if (HEADING.test(line)) {
			flush();
			heading = line.replace(/^#+\s*|\*\*/g, "").slice(0, 80);
			words = 0;
		} else {
			words += wordsIn(line);
		}
	}
	flush();
	return out.join("\n");
}

/** Count the answer's words, offered when a rubric item is about length. */
export const count = action<Workspace, null>({
	name: "count",
	when: (state) => state.workspace.case.items.some((item) => LENGTH.test(item.text)),
	options: () => [{ key: "words", text: "Count the words of the answer, in total and for each section", arg: null }],
	observe: (workspace) => ({
		source: "word counts of the answer",
		text: workspace.case.files
			.filter((file) => file.role === "answer" && file.kind !== "image")
			.map(countWords)
			.join("\n"),
	}),
});

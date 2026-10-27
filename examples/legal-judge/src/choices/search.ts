import { choiceKind } from "@osolmaz/switch";
import type { CaseFile } from "../case.ts";
import type { Term } from "../terms.ts";
import { LIMITS, type World } from "../world.ts";

const choiceText = (term: Term): string => {
	const from = term.items.length > 0 ? term.items.join(", ") : "the answer";
	return `Find the passages in the answer and the documents that mention “${term.term}” (from ${from}${term.inDocuments ? "" : "; only in the answer"})`;
};

function hitsIn(file: CaseFile, needle: string, room: number): string[] {
	const hits: string[] = [];
	for (const unit of file.units) {
		const haystack = unit.text.toLowerCase();
		let at = haystack.indexOf(needle);
		while (at >= 0 && hits.length < room) {
			const around = unit.text.slice(Math.max(0, at - LIMITS.hitContext), at + needle.length + LIMITS.hitContext);
			const where = file.units.length > 1 ? `${file.path}, ${unit.label}` : file.path;
			hits.push(`${where}: …${around.replace(/\s+/g, " ")}…`);
			at = haystack.indexOf(needle, at + needle.length + LIMITS.hitContext);
		}
	}
	return hits;
}

/** Every passage that mentions a term, in the answer and in the documents. */
export function searchFiles(files: readonly CaseFile[], term: string): string {
	const needle = term.toLowerCase();
	const hits: string[] = [];
	for (const file of files) hits.push(...hitsIn(file, needle, LIMITS.hits - hits.length));
	return hits.length > 0 ? hits.join("\n") : "Not found in any file.";
}

/** Search one term from the rubric, or a figure or clause reference the answer cites. */
export const search = choiceKind<World, Term>({
	name: "search",
	menu(world, history) {
		const done = new Set(history.map((step) => step.key));
		return world.terms
			.filter((term) => !done.has(`search:${term.term.toLowerCase()}`))
			.slice(0, LIMITS.searchChoices)
			.map((term) => ({
				key: term.term.toLowerCase(),
				text: choiceText(term),
				arg: term,
				priority: 1,
				// The rubric items the term comes from, for tools that read the trace.
				data: { informs: [...term.items] },
			}));
	},
	run: (world, term) => ({
		source: `search for “${term.term}”`,
		text: searchFiles(world.case.files, term.term),
	}),
});

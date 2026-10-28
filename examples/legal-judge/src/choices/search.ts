import { choiceType } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "../case.ts";
import { found, type LegalState, SIZES, withEvidence } from "../state.ts";
import type { Term } from "../terms.ts";

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
			const around = unit.text.slice(Math.max(0, at - SIZES.hitContext), at + needle.length + SIZES.hitContext);
			const where = file.units.length > 1 ? `${file.path}, ${unit.label}` : file.path;
			hits.push(`${where}: …${around.replace(/\s+/g, " ")}…`);
			at = haystack.indexOf(needle, at + needle.length + SIZES.hitContext);
		}
	}
	return hits;
}

/** Every passage that mentions a term, in the answer and in the documents. */
export function searchFiles(files: readonly CaseFile[], term: string): string {
	const needle = term.toLowerCase();
	const hits: string[] = [];
	for (const file of files) hits.push(...hitsIn(file, needle, SIZES.hits - hits.length));
	return hits.length > 0 ? hits.join("\n") : "Not found in any file.";
}

/** Search one term from the rubric, or a figure or clause reference the answer cites, that was not searched yet. */
export const search = (legalCase: LegalCase, terms: readonly Term[]) =>
	choiceType<LegalState, Term>({
		type: "search",
		choices: (state) =>
			terms
				.filter((term) => !found(state, `search:${term.term.toLowerCase()}`))
				.slice(0, SIZES.searchChoices)
				.map((term) => ({
					key: term.term.toLowerCase(),
					text: choiceText(term),
					arg: term,
					priority: 1,
					// The rubric items the term comes from, for tools that read the trace.
					data: { informs: [...term.items] },
				})),
		transition: (state, term) =>
			withEvidence(state, {
				key: `search:${term.term.toLowerCase()}`,
				source: `search for “${term.term}”`,
				text: searchFiles(legalCase.files, term.term),
			}),
	});

import type { Item, JudgeCase } from "./case.ts";

/** A search term, the rubric items it comes from, and whether the task's documents mention it. */
export interface Term {
	readonly term: string;
	readonly items: readonly string[];
	readonly inDocuments: boolean;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Quoted text, amounts, durations, dates, references to sections, clauses or articles, and capitalized names. */
const PATTERNS: readonly RegExp[] = [
	/[“"]([^”"\n]{3,60})[”"]/g,
	/(?<=[\s(])'([^'\n]{3,60})'(?=[\s.,;:)])/g,
	/((?:[$€£₹]|\b(?:USD|EUR|GBP|INR|AED|OMR|CHF)\s?)\d[\d,.]*(?:\s?(?:million|billion|crore|lakh|m|bn|k)\b)?)/gi,
	/\b(\d[\d,.]*\s?(?:%|percent|per cent|days?|business days|months?|years?|hours?|weeks?|acres?|hectares?|sq\.?\s?ft|square feet|words))\b/gi,
	new RegExp(`\\b(\\d{1,2}\\s(?:${MONTHS})\\s\\d{4}|(?:${MONTHS})\\s\\d{1,2},?\\s\\d{4})\\b`, "g"),
	/\b((?:Section|Clause|Article|Schedule|Annex|Exhibit|Paragraph|Rule|Regulation|§)\s?\d+[A-Za-z]?(?:\.\d+)*(?:\([a-z0-9]+\))*)/g,
	/\b((?:[A-Z][a-z]+|[A-Z]{2,})(?:\s(?:of|and|the|for|de|du|&)\s|\s)(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s(?:[A-Z][a-z]+|[A-Z]{2,})){0,3})\b/g,
];
const GENERIC = /^(PASS|FAIL|The|This|If|It|A|An|Output|Answer|For|In|On|At|By|Do|Does|N\/A)\b/;

export function termsIn(text: string): string[] {
	const found: string[] = [];
	for (const pattern of PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const term = (match[1] ?? "").trim().replace(/[.,;:]$/, "");
			if (term.length >= 3 && !GENERIC.test(term) && !/^\d{1,2}$/.test(term)) found.push(term);
		}
	}
	return found;
}

/**
 * The terms worth searching: those of the rubric items, then the figures and section references the answer cites,
 * kept only when some file mentions them, with the terms the documents mention first.
 */
export function searchTerms(judgeCase: JudgeCase): Term[] {
	const answerText = textOf(judgeCase, "answer");
	const answer = answerText.toLowerCase();
	const documents = textOf(judgeCase, "document").toLowerCase();
	const seen = new Map<string, { term: string; items: string[] }>();
	for (const item of judgeCase.items) collect(seen, termsIn(item.text), item);
	collect(
		seen,
		termsIn(answerText).filter((term) => /\d/.test(term)),
		null,
	);
	return [...seen.values()]
		.map(({ term, items }) => ({
			term,
			items,
			inDocuments: documents.includes(term.toLowerCase()),
			inAnswer: answer.includes(term.toLowerCase()),
		}))
		.filter((term) => term.inDocuments || term.inAnswer)
		.sort((a, b) => Number(b.inDocuments) - Number(a.inDocuments))
		.map(({ term, items, inDocuments }) => ({ term, items, inDocuments }));
}

function collect(
	seen: Map<string, { term: string; items: string[] }>,
	terms: readonly string[],
	item: Item | null,
): void {
	for (const term of terms) {
		const known = seen.get(term.toLowerCase());
		if (known === undefined) seen.set(term.toLowerCase(), { term, items: item === null ? [] : [item.id] });
		else if (item !== null && !known.items.includes(item.id)) known.items.push(item.id);
	}
}

function textOf(judgeCase: JudgeCase, role: "answer" | "document"): string {
	return judgeCase.files
		.filter((file) => file.role === role)
		.flatMap((file) => file.units.map((unit) => unit.text))
		.join("\n");
}

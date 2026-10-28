import type { CaseFile, LegalCase } from "../../src/case.ts";
import type { CaseFolder, Evidence, LegalState } from "../../src/state.ts";

export function file(
	id: string,
	path: string,
	role: CaseFile["role"],
	texts: string[],
	extra: Partial<CaseFile> = {},
): CaseFile {
	const units = texts.map((text, index) => ({ label: `page ${String(index + 1)}`, text }));
	const words = units.reduce((sum, unit) => sum + unit.text.split(/\s+/).filter(Boolean).length, 0);
	return {
		id,
		path,
		role,
		format: "text",
		units,
		words,
		renders: [],
		formatting: null,
		marks: 0,
		error: null,
		...extra,
	};
}

/** A small case: a memo as the answer, a two-page lease and a contract as documents. */
export function legalCase(overrides: Partial<LegalCase> = {}): LegalCase {
	return {
		schema: 1,
		id: "case-1",
		request: "Review the lease and write a memo.",
		items: [
			{
				id: "S-001",
				category: "substance",
				text: 'PASS if the memo states the "notice period" of 30 days under Section 4.2.',
			},
			{ id: "F-001", category: "form", text: "PASS if the memo has at most 300 words." },
		],
		files: [
			file("a1", "output/memo.md", "answer", [
				"# Memo\nThe notice period is 30 days under Section 4.2.\n## Advice\nSign it.",
			]),
			file(
				"d1",
				"documents/lease.pdf",
				"document",
				["Section 4.2 sets a notice period of 30 days.", "Rent is USD 2,500 a month."],
				{ format: "pdf" },
			),
			file("d2", "documents/contract.docx", "document", ["P1: The parties agree."], {
				format: "docx",
				formatting:
					"Tracked insertions: 1; tracked deletions: 0.\n  inserted: agree\nComments: 0.\nRuns with direct formatting: 0.",
				marks: 1,
			}),
		],
		...overrides,
	};
}

/** A case's folder whose images hold their own path as their data. */
export const folderOf = (legal: LegalCase): CaseFolder => ({
	case: legal,
	image: (render) =>
		Promise.resolve({ type: "image", label: render.label, mimeType: render.mimeType, data: `data:${render.path}` }),
});

/** Evidence with `key` as its source too. */
export const evidence = (key: string, text = "x", extra: Partial<Evidence> = {}): Evidence => ({
	key,
	source: key,
	text,
	...extra,
});

/** A state that holds `entries`. */
export const stateOf = (...entries: Evidence[]): LegalState => ({ evidence: entries });

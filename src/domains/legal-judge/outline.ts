import type { Node } from "../../core/index.ts";
import type { CaseFile, LegalCase } from "./case.ts";

/**
 * The answer as a tree for pointing: files, sections, paragraphs, sentences. Sections come from the headings the
 * answer already has; an answer without headings is grouped into sections of a few paragraphs.
 */

/** One sentence of the answer, with where it is, for the checks that read it. */
export interface Sentence {
	readonly id: string;
	readonly text: string;
	readonly paragraph: string;
	readonly file: string;
	readonly section: string;
}

export interface Outline {
	readonly root: Node;
	readonly sentences: ReadonlyMap<string, Sentence>;
}

interface Section {
	readonly title: string;
	readonly paragraphs: string[];
}

const HEADING = /^(#{1,6}\s+\S|\*\*[^*]{2,120}\*\*:?\s*$|\d+(\.\d+)*[.)]\s+[A-Z]|\*\*\d+(\.\d+)*\.?\s)/;
const DOCX_LINE = /^P\d+( \[[^\]]*\])?: /;
const DOCX_HEADING = /^P\d+ \[Heading[^\]]*\]: /;
const STARTS_PARAGRAPH = /^([-*•]\s|\|\s?|\d+[.)]\s|row \d+:|TABLE \d+:)/;
const SENTENCE_END = /(?<=[.!?;])\s+(?=[A-Z0-9"“'(§•])/;
const GROUP = 8;

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);
export const shorten = (text: string, words: number): string => {
	const all = wordsOf(text);
	return all.length <= words ? all.join(" ") : `${all.slice(0, words).join(" ")} …`;
};

export const sentencesIn = (paragraph: string): string[] =>
	paragraph
		.split(SENTENCE_END)
		.map((sentence) => sentence.trim())
		.filter((sentence) => wordsOf(sentence).length >= 2);

function isHeading(line: string): boolean {
	return DOCX_HEADING.test(line) || HEADING.test(line.replace(DOCX_LINE, ""));
}

/** Lines into paragraphs: a blank line, a list item, a table row or a Word paragraph starts a new one. */
function paragraphsOf(lines: readonly string[]): string[] {
	const paragraphs: string[] = [];
	let current: string[] = [];
	const flush = () => {
		if (current.length > 0) paragraphs.push(current.join(" "));
		current = [];
	};
	for (const line of lines) {
		if (line.trim() === "") {
			flush();
			continue;
		}
		if (DOCX_LINE.test(line) || STARTS_PARAGRAPH.test(line)) flush();
		current.push(line.replace(DOCX_LINE, "").trim());
	}
	flush();
	return paragraphs;
}

/** A file's text into sections at its headings, or into groups of paragraphs when it has none. */
export function sectionsOf(text: string): Section[] {
	const sections: { title: string; lines: string[] }[] = [];
	for (const line of text.split("\n")) {
		if (isHeading(line)) sections.push({ title: line.replace(DOCX_LINE, "").replace(/[#*]/g, "").trim(), lines: [] });
		else if (sections.length === 0) sections.push({ title: "", lines: [line] });
		else sections.at(-1)?.lines.push(line);
	}
	const parsed = sections.map(({ title, lines }) => ({ title, paragraphs: paragraphsOf(lines) }));
	if (parsed.length === 1 && parsed[0]?.title === "") return grouped(parsed[0].paragraphs);
	return parsed.filter((section) => section.paragraphs.length > 0 || section.title !== "");
}

function grouped(paragraphs: readonly string[]): Section[] {
	const sections: Section[] = [];
	for (let start = 0; start < paragraphs.length; start += GROUP) {
		const slice = paragraphs.slice(start, start + GROUP);
		sections.push({ title: shorten(slice[0] ?? "", 20), paragraphs: slice });
	}
	return sections;
}

const fileText = (file: CaseFile): string => file.units.map((unit) => unit.text).join("\n\n");

function fileNode(file: CaseFile, index: Map<string, Sentence>): Node {
	const sections = sectionsOf(fileText(file)).map((section, s) => {
		const sectionTitle = section.title === "" ? `part ${String(s + 1)}` : shorten(section.title, 25);
		const paragraphs = section.paragraphs.map((paragraph, p) => {
			const sentences = sentencesIn(paragraph).map((text, n): Node => {
				const id = `${file.id}:${String(s)}:${String(p)}:${String(n)}`;
				index.set(id, { id, text, paragraph, file: file.path, section: sectionTitle });
				return { id, title: shorten(text, 80) };
			});
			return {
				id: `${file.id}:${String(s)}:${String(p)}`,
				title: shorten(paragraph, 30),
				children: () => sentences,
			};
		});
		return { id: `${file.id}:${String(s)}`, title: sectionTitle, children: () => paragraphs };
	});
	return { id: file.id, title: file.path, children: () => sections };
}

/** The answer's readable files as one tree, and every sentence by its node id. */
export function outlineOf(legalCase: LegalCase): Outline {
	const sentences = new Map<string, Sentence>();
	const files = legalCase.files
		.filter((file) => file.role === "answer" && file.error === null && file.units.length > 0)
		.map((file) => fileNode(file, sentences));
	return { root: { id: "answer", title: "the answer", children: () => files }, sentences };
}

const STOP = new Set(
	"that this with from have must should shall will which their there these those than then into upon such each other only also where when what does about under over more most within without between including".split(
		" ",
	),
);

/** The words a requirement turns on: longer words that are not common, and every number. */
export const keyWords = (text: string): string[] => [
	...new Set(
		wordsOf(text.toLowerCase().replace(/[^a-z0-9.,%$€£§\s-]/g, " "))
			.map((word) => word.replace(/[.,]+$/, ""))
			.filter((word) => /\d/.test(word) || (word.length >= 5 && !STOP.has(word))),
	),
];

/** The answer's sentences that share the most key words with a requirement: the search shortcut for pointing. */
export function candidatesFor(outline: Outline, requirement: string, count = 10): Node[] {
	const keys = keyWords(requirement);
	return [...outline.sentences.values()]
		.map((sentence) => {
			const lower = sentence.text.toLowerCase();
			return { sentence, score: keys.filter((key) => lower.includes(key)).length };
		})
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, count)
		.map(({ sentence }) => ({ id: sentence.id, title: shorten(sentence.text, 80) }));
}

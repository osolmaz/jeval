import type { Element } from "@xmldom/xmldom";
import type { Unit } from "../case.ts";
import { children, elements, Package, squash, textOf, W } from "./ooxml.ts";
import { textUnits } from "./units.ts";

export interface WordFile {
	readonly units: Unit[];
	/** Tracked changes, comments and runs with direct formatting, as text for the judge. */
	readonly formatting: string;
	/** The number of tracked changes and comments. */
	readonly marks: number;
}

const LISTED = { changes: 60, comments: 40, runs: 120 } as const;
const MARKS = ["b", "i", "u", "strike", "highlight"] as const;

const attribute = (element: Element | undefined, name: string): string | null =>
	element?.getAttributeNS(W, name) ?? null;

function paragraphLine(paragraph: Element, index: number): string | null {
	const text = textOf(paragraph, W, "t");
	if (text.trim() === "") return null;
	const style = attribute(children(children(paragraph, W, "pPr")[0] ?? paragraph, W, "pStyle")[0], "val");
	return `P${String(index)}${style === null ? "" : ` [${style}]`}: ${text}`;
}

function tableLines(table: Element, index: number): string[] {
	const rows = elements(table, W, "tr").map((row, number) => {
		const cells = elements(row, W, "tc").map((cell) => squash(textOf(cell, W, "t")));
		return `  row ${String(number + 1)}: ${cells.join(" | ")}`;
	});
	return [`TABLE ${String(index)}:`, ...rows];
}

/** The body as numbered paragraph lines, with each paragraph's style and each table's rows, in document order. */
function bodyLines(body: Element): string[] {
	const lines: string[] = [];
	let paragraphs = 0;
	let tables = 0;
	for (const child of children(body, W, null)) {
		if (child.localName === "p") {
			paragraphs += 1;
			const line = paragraphLine(child, paragraphs);
			if (line !== null) lines.push(line);
		} else if (child.localName === "tbl") {
			tables += 1;
			lines.push(...tableLines(child, tables));
		}
	}
	return lines;
}

function marked(run: Element): string[] {
	const properties = children(run, W, "rPr")[0];
	if (properties === undefined) return [];
	return MARKS.filter((mark) => {
		const element = children(properties, W, mark)[0];
		return element !== undefined && !["0", "false", "none"].includes(attribute(element, "val") ?? "");
	});
}

function formattedRuns(root: Element): string[] {
	const runs: string[] = [];
	elements(root, W, "p").forEach((paragraph, index) => {
		for (const run of elements(paragraph, W, "r")) {
			const marks = marked(run);
			const text = textOf(run, W, "t").trim();
			if (marks.length > 0 && text !== "")
				runs.push(`  P${String(index + 1)} ${marks.join("+")}: ${text.slice(0, 120)}`);
		}
	});
	return runs;
}

function comments(pkg: Package): string[] {
	if (!pkg.has("word/comments.xml")) return [];
	const root = pkg.xml("word/comments.xml").documentElement;
	return root === null ? [] : elements(root, W, "comment").map((comment) => squash(textOf(comment, W, "t")));
}

function formatting(pkg: Package, root: Element): { text: string; marks: number } {
	const inserted = elements(root, W, "ins")
		.map((element) => squash(textOf(element, W, "t")))
		.filter(Boolean);
	const deleted = elements(root, W, "del")
		.map((element) => squash(textOf(element, W, "delText")))
		.filter(Boolean);
	const noted = comments(pkg);
	const runs = formattedRuns(root);
	const lines = [
		`Tracked insertions: ${String(inserted.length)}; tracked deletions: ${String(deleted.length)}.`,
		...inserted.slice(0, LISTED.changes).map((text) => `  inserted: ${text}`),
		...deleted.slice(0, LISTED.changes).map((text) => `  deleted: ${text}`),
		`Comments: ${String(noted.length)}.`,
		...noted.slice(0, LISTED.comments).map((text) => `  comment: ${text}`),
		`Runs with direct formatting: ${String(runs.length)}.`,
		...runs.slice(0, LISTED.runs),
	];
	return { text: lines.join("\n"), marks: inserted.length + deleted.length + noted.length };
}

/** A Word file's text as numbered paragraphs and tables, and its tracked changes, comments and formatting. */
export function readDocx(bytes: Uint8Array): WordFile {
	const pkg = new Package(bytes);
	const root = pkg.xml("word/document.xml").documentElement;
	const body = root === null ? undefined : elements(root, W, "body")[0];
	if (root === null || body === undefined) throw new Error("the Word file has no body");
	const found = formatting(pkg, root);
	return {
		units: textUnits(bodyLines(body).join("\n"), "paragraph lines", 80),
		formatting: found.text,
		marks: found.marks,
	};
}

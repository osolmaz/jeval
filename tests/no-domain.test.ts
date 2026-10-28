import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EXAMPLES = new URL("../examples/", import.meta.url);

/** Each example's words, from its `domain-words.txt`: one word a line, and `#` starts a comment. */
async function exampleWords(): Promise<Record<string, string[]>> {
	const folders = (await readdir(EXAMPLES, { withFileTypes: true })).filter((entry) => entry.isDirectory());
	const lists = await Promise.all(
		folders.map(async ({ name }) => {
			const text = await readFile(new URL(`${name}/domain-words.txt`, EXAMPLES), "utf8");
			const words = text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
			return [name, words.map((word) => word.trim().toLowerCase())] as const;
		}),
	);
	return Object.fromEntries(lists);
}

/**
 * The words of the examples, which switch must not know: AGENTS.md has the rule that switch knows nothing of any
 * domain. A word counts at the start of a word or of a part of a camelCase name, so `chessPart` and `toPgn` count too.
 */
async function domainWords(): Promise<RegExp> {
	const words = Object.values(await exampleWords()).flat();
	return new RegExp(`\\b(${words.join("|")})`, "i");
}

/** The words of a line, with each camelCase name split into its parts. */
const wordsOf = (line: string): string => line.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

async function filesIn(folder: string): Promise<string[]> {
	const entries = await readdir(folder, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) =>
			entry.isDirectory() ? filesIn(join(folder, entry.name)) : [join(folder, entry.name)],
		),
	);
	return nested.flat();
}

/** The lines of the files in `folders`, from this repository's root, that match `pattern` once split into words. */
async function linesMatching(folders: readonly string[], pattern: RegExp): Promise<string[]> {
	const files = (
		await Promise.all(folders.map((folder) => filesIn(new URL(`../${folder}`, import.meta.url).pathname)))
	)
		.flat()
		.sort();
	expect(files.length).toBeGreaterThan(10);
	const found: string[] = [];
	for (const file of files) {
		(await readFile(file, "utf8")).split("\n").forEach((line, index) => {
			if (pattern.test(wordsOf(line))) found.push(`${file}:${String(index + 1)}: ${line.trim()}`);
		});
	}
	return found;
}

/** What only a web page or its server has: the browser's types, the document, HTML, styles and an HTTP server. */
const WEB = /lib="dom"|\bHTML|\bdocument\.|<html|<style|\.css\b|node:http|\bbrowser|\bweb page/i;

describe("switch's sources", () => {
	it("name no domain, in code, comments, help texts or styles, and neither does the viewer", async () => {
		expect(await linesMatching(["src", "viewer/src"], await domainWords())).toEqual([]);
	});

	it("are tested without any domain's words, except in this test of the words", async () => {
		const found = await linesMatching(["tests", "viewer/tests"], await domainWords());
		expect(found.filter((line) => !line.includes("/tests/no-domain.test.ts:"))).toEqual([]);
	});

	it("have no web page, server or browser code: the viewer is a package of its own", async () => {
		expect(await linesMatching(["src"], WEB)).toEqual([]);
	});

	it("are checked for the words that every example lists, also inside names, and for web code", async () => {
		const lists = await exampleWords();
		for (const [name, words] of Object.entries(lists)) expect(words.length, name).toBeGreaterThan(5);
		const words = await domainWords();
		for (const name of ["chessPart", "toPgn", "legalCase", "judgeDefinition", "rubricItems", "chess_board"]) {
			expect(words.test(wordsOf(name))).toBe(true);
		}
		for (const name of ["keyboard", "removeEventListener", "criteria", "labels", "checkSquare"]) {
			expect(words.test(wordsOf(name))).toBe(false);
		}
		for (const line of ['/// <reference lib="dom" />', "): HTMLElement {", 'from "node:http";', "page.css"]) {
			expect(WEB.test(line)).toBe(true);
		}
	});
});

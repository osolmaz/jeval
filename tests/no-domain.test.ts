import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Words of the examples that switch must not know: AGENTS.md has the rule that switch knows nothing of any domain. A
 * word counts at the start of a word or of a part of a camelCase name, so `chessPart` and `toPgn` count too.
 */
const DOMAIN_WORDS =
	/\b(chess|legal|judge|rubric|stockfish|pgn|game|board|opponent|checkmate|fen|uci|engine|pawn|knight|bishop|rook|queen|evidence|verdict|grader|qualifier)/i;

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

describe("switch's sources", () => {
	it("name no domain, in code, comments, help texts or styles", async () => {
		const files = await filesIn(new URL("../src", import.meta.url).pathname);
		expect(files.length).toBeGreaterThan(20);
		const named: string[] = [];
		for (const file of files) {
			(await readFile(file, "utf8")).split("\n").forEach((line, index) => {
				if (DOMAIN_WORDS.test(wordsOf(line))) named.push(`${file}:${String(index + 1)}: ${line.trim()}`);
			});
		}
		expect(named).toEqual([]);
	});

	it("are checked for words inside names too", () => {
		for (const name of ["chessPart", "toPgn", "legalCase", "judgeDefinition", "rubricItems", "chess_board"]) {
			expect(DOMAIN_WORDS.test(wordsOf(name))).toBe(true);
		}
		for (const name of ["keyboard", "removeEventListener", "criteria", "labels", "checkSquare"]) {
			expect(DOMAIN_WORDS.test(wordsOf(name))).toBe(false);
		}
	});
});

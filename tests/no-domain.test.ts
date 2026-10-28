import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Words of the examples that switch must not know: AGENTS.md has the rule that switch knows nothing of any domain. */
const DOMAIN_WORDS = /\b(chess|legal|judges?|rubrics?|stockfish|pgn)\b/i;

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
				if (DOMAIN_WORDS.test(line)) named.push(`${file}:${String(index + 1)}: ${line.trim()}`);
			});
		}
		expect(named).toEqual([]);
	});
});

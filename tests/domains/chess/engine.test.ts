import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EngineError, STANDARD_START } from "../../../src/domains/chess/index.ts";
import { loadGame, uciEngine } from "../../../src/domains/chess/load.ts";

let folder = "";

/** A UCI engine as a script: it logs each command next to itself, names itself, and always plays e7e5. */
const FAKE_ENGINE = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const log = require("node:path").join(__dirname, "commands.txt");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
	appendFileSync(log, line + "\\n");
	if (line === "uci") process.stdout.write("id name Fake Engine 1\\nuciok\\n");
	if (line.startsWith("go")) process.stdout.write("info depth 1 score cp 20\\nbestmove e7e5 ponder g1f3\\n");
	if (line === "quit") process.exit(0);
});
`;

async function script(name: string, text: string): Promise<string> {
	const path = join(folder, name);
	await writeFile(path, text);
	await chmod(path, 0o755);
	return path;
}

async function caseFolder(name: string, fields: Record<string, unknown>): Promise<string> {
	const path = join(folder, name);
	await mkdir(path);
	await writeFile(join(path, "case.json"), JSON.stringify({ id: name, ...fields }));
	return path;
}

beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-engine-"));
});

afterAll(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe("a UCI engine", () => {
	it("tells its name, and its best move in a position after thinking the move time", async () => {
		const engine = await uciEngine(await script("fake.cjs", FAKE_ENGINE), 50);
		expect(engine.name).toBe("Fake Engine 1");
		expect(await engine.move(STANDARD_START)).toBe("e7e5");
		// Each question starts the engine afresh: the handshake, then the search. Each engine quits after it answers,
		// in its own time, so the order of the two quits is not fixed.
		await vi.waitFor(async () => {
			const commands = (await readFile(join(folder, "commands.txt"), "utf8")).split("\n");
			expect(commands.filter((line) => line === "quit")).toHaveLength(2);
			expect(commands.filter((line) => line !== "quit")).toEqual([
				"uci",
				"uci",
				`position fen ${STANDARD_START}`,
				"go movetime 50",
				"",
			]);
		});
	});

	it("fails when the engine does not start or stops before it answers", async () => {
		await expect(uciEngine(join(folder, "missing"), 50)).rejects.toThrow(/^cannot start/);
		const quitter = await script("quitter.cjs", `#!${process.execPath}\nprocess.exit(3);\n`);
		await expect(uciEngine(quitter, 50)).rejects.toThrow(EngineError);
	});

	it("comes with a game against Stockfish, from the binary that STOCKFISH names", async () => {
		const binary = await script("named.cjs", FAKE_ENGINE);
		const stockfish = await caseFolder("sf", { opponent: "stockfish", side: "black", movetime: 200 });
		const game = await loadGame(stockfish, { STOCKFISH: binary });
		expect(game).toMatchObject({ id: "sf", opponent: "stockfish", movetime: 200, engine: { name: "Fake Engine 1" } });
		await expect(loadGame(stockfish, {})).rejects.toThrow(/set STOCKFISH/);
		const random = await loadGame(await caseFolder("random", {}), {});
		expect(random).not.toHaveProperty("engine");
	});
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefinitionError, hashOf } from "@osolmaz/switch";
import { resultSchema, route, runCases, runRecordSchema } from "@osolmaz/switch/cli";
import { fakeDecider } from "@osolmaz/switch/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHESS, LIMITS } from "../src/index.ts";
import { chessSetup } from "../src/setup.ts";
import { chessViewer } from "../src/viewer.ts";
import { picking } from "./helpers/chess.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "chess-cli-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

/** A run of chess games `ids`, in which the model resigns at once. */
async function chessRun(ids: readonly string[]): Promise<string> {
	const folders = await Promise.all(
		ids.map(async (id) => {
			const game = join(folder, "games", id);
			await mkdir(game, { recursive: true });
			await writeFile(join(game, "case.json"), JSON.stringify({ id, side: "white", seed: 1 }));
			return game;
		}),
	);
	const out = join(folder, "run");
	const lines: string[] = [];
	await runCases(await chessSetup(undefined), folders, fakeDecider(picking("stop")), {
		out,
		concurrency: 1,
		log: (line) => lines.push(line),
	});
	expect(lines).toEqual(
		ids.map((id) => expect.stringContaining(`${id}: 1 steps, {"result":"loss","reason":"resignation"`) as unknown),
	);
	return out;
}

describe("the chess harness", () => {
	it("takes no definition file", async () => {
		await expect(chessSetup("definition.json")).rejects.toThrow(DefinitionError);
		await expect(chessSetup("definition.json")).rejects.toThrow(/takes no definition file/);
	});

	it("records a game's outcome, and its texts and limits as its definition", async () => {
		const out = await chessRun(["g1"]);
		const result = resultSchema.parse(JSON.parse(await readFile(join(out, "cases", "g1", "result.json"), "utf8")));
		expect(result.outcome).toMatchObject({ result: "loss", reason: "resignation", moves: 0 });
		const { definition } = runRecordSchema.parse(JSON.parse(await readFile(join(out, "run.json"), "utf8")));
		expect(definition).toEqual({
			name: "chess",
			hash: hashOf({ stop: CHESS.stop, instructions: CHESS.instructions, limits: LIMITS }),
			content: { stop: "Resign the game", instructions: CHESS.instructions, limits: { ...LIMITS } },
		});
	});

	it("serves a game's page with the chess part, its pieces, its styles and its summary in the index", async () => {
		const out = await chessRun(["g1", "g 2"]);
		expect((await route(out, "/", { chess: chessViewer })).body).toContain(
			'<a href="/case/g%202">g 2</a> <span class="meta">loss · resignation</span>',
		);
		const page = await route(out, "/case/g1", { chess: chessViewer });
		expect(page.body).toContain('registerPart("chess", chessPart)');
		expect(page.body).toContain("data:image/svg+xml;base64,");
		expect(page.body).toContain(".board {");
		expect(page.body).toContain(':root[data-domain="chess"] {');
		const plain = (await route(out, "/case/g1")).body;
		expect(plain).not.toContain("data:image/svg+xml;base64,");
		expect(plain).not.toContain(".board");
	});
});

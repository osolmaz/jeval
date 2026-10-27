import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCases } from "../../src/cli/commands.ts";
import { DomainError, domainNamed, VIEWERS } from "../../src/cli/domains.ts";
import { resultSchema, runRecordSchema } from "../../src/cli/runs.ts";
import { caseVersion, onlyCase, route, serveRun, ViewError, writeCasePage } from "../../src/cli/view.ts";
import { hashOf, SetupError } from "../../src/core/index.ts";
import { chess, LIMITS } from "../../src/domains/chess/index.ts";
import type { Session } from "../../src/view/index.ts";
import { DEFAULT_JUDGE } from "../../src/domains/legal-judge/index.ts";
import { picking } from "../helpers/chess.ts";
import { fakeDecider } from "../helpers/fakes.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-view-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

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
	await runCases(await domainNamed("chess"), folders, fakeDecider(picking("stop")), {
		out,
		concurrency: 1,
		log: (line) => lines.push(line),
	});
	expect(lines).toEqual(
		ids.map((id) => expect.stringContaining(`${id}: 1 steps, {"result":"loss","reason":"resignation"`) as unknown),
	);
	return out;
}

describe("domains on the command line", () => {
	it("refuses an unknown domain and a definition file for chess", async () => {
		await expect(domainNamed("poker")).rejects.toThrow(DomainError);
		await expect(domainNamed("chess", DEFAULT_JUDGE)).rejects.toThrow(SetupError);
		await expect(domainNamed("chess", DEFAULT_JUDGE)).rejects.toThrow(/takes no definition file/);
	});

	it("sets legal-judge up with its default judge when no definition file is given", async () => {
		const named = await domainNamed("legal-judge", DEFAULT_JUDGE);
		expect((await domainNamed("legal-judge")).definition).toEqual(named.definition);
	});

	it("records a chess game's outcome, and its texts and limits as its definition", async () => {
		const out = await chessRun(["g1"]);
		const result = resultSchema.parse(JSON.parse(await readFile(join(out, "cases", "g1", "result.json"), "utf8")));
		expect(result.outcome).toMatchObject({ result: "loss", reason: "resignation", moves: 0 });
		expect(result.categories).toEqual({});
		const { definition } = runRecordSchema.parse(JSON.parse(await readFile(join(out, "run.json"), "utf8")));
		expect(definition).toEqual({
			name: "chess",
			hash: hashOf({ stop: chess.stop, instructions: chess.instructions, limits: LIMITS }),
			content: { stop: "Resign the game", instructions: chess.instructions, limits: { ...LIMITS } },
		});
	});
});

describe("the viewer", () => {
	it("serves the index, and each case's page, session and version", async () => {
		const out = await chessRun(["g1", "g 2"]);
		const index = await route(out, "/");
		expect(index.body).toContain('<a href="/case/g%202">g 2</a> <span class="meta">loss, resignation</span>');
		const page = await route(out, "/case/g1", VIEWERS);
		expect(Object.keys(VIEWERS)).toEqual(["chess"]);
		expect(page.body).toContain('registerPart("chess", chessPart)');
		expect((await route(out, "/case/g1")).body).not.toContain("data:image/svg+xml;base64,");
		expect(page.type).toMatch(/^text\/html/);
		expect(page.body).toContain(
			'"sessionUrl":"/case/g1/session.json","versionUrl":"/case/g1/version","indexUrl":"/"',
		);
		expect(page.body).toContain("data:image/svg+xml;base64,");
		const session = JSON.parse((await route(out, "/case/g%202/session.json")).body) as Session;
		expect(session).toMatchObject({
			finished: true,
			outcome: { result: "loss" },
			story: { case: "g 2", domain: "chess" },
		});
		expect((await route(out, "/case/g%202/version")).body).toBe(await caseVersion(out, "g 2"));
	});

	it("opens a case's page before the case starts, but nothing else of it", async () => {
		const out = join(folder, "not-yet");
		expect((await route(out, "/")).body).toContain('<ul class="list"></ul>');
		expect((await route(out, "/case/g1")).status).toBe(200);
		expect((await route(out, "/case/g1/session.json")).status).toBe(404);
		expect((await route(out, "/case/..%2Frun.json/version")).status).toBe(404);
		expect((await route(out, "/case/g1/other")).status).toBe(404);
		expect((await route(out, "/elsewhere")).status).toBe(404);
	});

	it("writes a page with the session in it, and needs a case named when the run has more than one", async () => {
		const out = await chessRun(["g1", "g2"]);
		await expect(onlyCase(out)).rejects.toThrow(ViewError);
		const file = join(folder, "g1.html");
		await writeCasePage(out, "g1", file, VIEWERS);
		const page = await readFile(file, "utf8");
		expect(page).toContain("<title>g1 · switch</title>");
		expect(page).toContain('"session":{');
		expect(page).not.toContain('"sessionUrl":"');
		await rm(join(out, "cases", "g2"), { recursive: true });
		expect(await onlyCase(out)).toBe("g1");
	});

	it("tells a case's version by the size of its trace and whether it has a result", async () => {
		const out = await chessRun(["g1"]);
		expect(await caseVersion(out, "g1")).toMatch(/^\d+:true$/);
		expect(await caseVersion(out, "missing")).toBe("0:false");
	});

	it("serves over HTTP, with an error reply when a case cannot be read", async () => {
		const out = await chessRun(["g1"]);
		const server = await serveRun(out, 0);
		const { port } = server.address() as AddressInfo;
		const ok = await fetch(`http://127.0.0.1:${String(port)}/case/g1/version`);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("cache-control")).toBe("no-store");
		await writeFile(join(out, "cases", "g1", "trace.jsonl"), "not json\n");
		const broken = await fetch(`http://127.0.0.1:${String(port)}/case/g1/session.json`);
		expect(broken.status).toBe(500);
		await new Promise((resolve) => server.close(resolve));
		await expect(serveRun(out, port))
			.resolves.toBeDefined()
			.then(async () => {
				const taken = await serveRun(out, port).catch((error: unknown) => error);
				expect(taken).toBeInstanceOf(Error);
			});
	});
});

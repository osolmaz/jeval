import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCases } from "../../src/cli/commands.ts";
import { DomainError, domainNamed } from "../../src/cli/domains.ts";
import { resultSchema } from "../../src/cli/runs.ts";
import { caseVersion, onlyCase, route, ViewError, viewServer, writeCasePage } from "../../src/cli/view.ts";
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
	it("refuses an unknown domain and a judge file for chess", async () => {
		await expect(domainNamed("poker")).rejects.toThrow(DomainError);
		await expect(domainNamed("chess", DEFAULT_JUDGE)).rejects.toThrow(/takes no judge file/);
	});

	it("records a chess game's outcome and its texts as the judge", async () => {
		const out = await chessRun(["g1"]);
		const result = resultSchema.parse(JSON.parse(await readFile(join(out, "cases", "g1", "result.json"), "utf8")));
		expect(result.outcome).toMatchObject({ result: "loss", reason: "resignation", moves: 0 });
		const record = JSON.parse(await readFile(join(out, "run.json"), "utf8")) as {
			judge: { name: string; hash: string };
		};
		expect(record.judge.name).toBe("chess");
		expect(record.judge.hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("the viewer", () => {
	it("serves the index, each case's page and its version, and nothing else", async () => {
		const out = await chessRun(["g1", "g 2"]);
		const index = await route(out, "/");
		expect(index.body).toContain('<a href="/case/g%202">g 2</a> <span class="meta">loss, resignation</span>');
		const page = await route(out, "/case/g1");
		expect(page.type).toMatch(/^text\/html/);
		expect(page.body).toContain('class="board"');
		expect(page.body).toContain('data-live="/case/g1/version"');
		expect((await route(out, "/case/g%202/version")).body).toBe(await caseVersion(out, "g 2"));
		expect((await route(out, "/case/..%2Frun.json")).status).toBe(404);
		expect((await route(out, "/elsewhere")).status).toBe(404);
	});

	it("writes a page without the live check, and needs a case named when the run has more than one", async () => {
		const out = await chessRun(["g1", "g2"]);
		await expect(onlyCase(out)).rejects.toThrow(ViewError);
		const file = join(folder, "g1.html");
		await writeCasePage(out, "g1", file);
		const page = await readFile(file, "utf8");
		expect(page).toContain("<h1>g1</h1>");
		expect(page).not.toContain("data-live");
		await rm(join(out, "cases", "g2"), { recursive: true });
		expect(await onlyCase(out)).toBe("g1");
	});

	it("tells a case's version by the size of its trace and whether it has a result", async () => {
		const out = await chessRun(["g1"]);
		expect(await caseVersion(out, "g1")).toMatch(/^\d+:true$/);
		expect(await caseVersion(out, "missing")).toBe("0:false");
	});

	it("answers over HTTP, with an error page when the run folder cannot be read", async () => {
		const out = await chessRun(["g1"]);
		for (const [run, status] of [
			[out, 200],
			[join(folder, "nothing"), 500],
		] as const) {
			const server = viewServer(run);
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const { port } = server.address() as AddressInfo;
			const response = await fetch(`http://127.0.0.1:${String(port)}/case/g1`);
			expect(response.status).toBe(status);
			expect(response.headers.get("cache-control")).toBe("no-store");
			await new Promise((resolve) => server.close(resolve));
		}
	});
});

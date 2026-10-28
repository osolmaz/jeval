import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCases } from "../../src/cli/commands.ts";
import { DomainError, domainNamed, domainOf, viewersOf } from "../../src/cli/domains.ts";
import { caseVersion, onlyCase, route, serveRun, ViewError, writeCasePage } from "../../src/cli/view.ts";
import { STOP_KEY } from "../../src/core/index.ts";
import type { Session } from "../../src/view/index.ts";
import { factsFolder, factsSetup } from "../helpers/facts.ts";
import { answering, fakeDecider } from "../helpers/fakes.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "switch-view-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

/** A run of the test domain on cases `ids`, in which the model stops at once. */
async function factsRun(ids: readonly string[]): Promise<string> {
	const folders = await Promise.all(ids.map((id) => factsFolder(folder, id)));
	const out = join(folder, "run");
	await runCases(await factsSetup(undefined), folders, fakeDecider(answering(0.6, () => STOP_KEY)), {
		out,
		concurrency: 1,
		log: () => undefined,
	});
	return out;
}

const viewer = { modules: [], config: () => Promise.resolve({ shade: "dark" }) };

describe("a harness's domains", () => {
	it("are picked by name, or the only one without a name", async () => {
		const one = { facts: { setup: factsSetup } };
		expect(domainOf(one, undefined)).toBe(one.facts);
		expect((await domainNamed(one)).name).toBe("facts");
		await expect(domainNamed(one, "facts", "x.json")).rejects.toThrow(/takes no definition file/);
		const two = { facts: { setup: factsSetup }, more: { setup: factsSetup, viewer } };
		expect(() => domainOf(two, undefined)).toThrow(DomainError);
		expect(() => domainOf(two, undefined)).toThrow("the harness has 2 domains; name one with --domain: facts, more");
		expect(() => domainOf(two, "poker")).toThrow("no domain poker; known: facts, more");
		expect(viewersOf(two)).toEqual({ more: viewer });
	});
});

describe("the viewer", () => {
	it("serves the index, and each case's page, session and version, with the parts' configs", async () => {
		const out = await factsRun(["f1", "f 2"]);
		expect((await route(out, "/")).body).toContain('<a href="/case/f%202">f 2</a></li>');
		const summarized = {
			...viewer,
			summary: (outcome: Readonly<Record<string, unknown>>) => `${String(outcome["reason"])}!`,
		};
		const index = await route(out, "/", { facts: summarized });
		expect(index.body).toContain('<a href="/case/f%202">f 2</a> <span class="meta">stop!</span>');
		expect(JSON.parse((await route(out, "/case/f1/session.json", { facts: summarized })).body)).toMatchObject({
			summary: "stop!",
		});
		const page = await route(out, "/case/f1", { facts: viewer });
		expect(page.type).toMatch(/^text\/html/);
		expect(page.body).toContain(
			'"sessionUrl":"/case/f1/session.json","versionUrl":"/case/f1/version","indexUrl":"/","parts":{"facts":{"shade":"dark"}}',
		);
		const session = JSON.parse((await route(out, "/case/f%202/session.json")).body) as Session;
		expect(session).toMatchObject({
			finished: true,
			outcome: { result: "answered" },
			summary: null,
			story: { case: "f 2", domain: "facts" },
		});
		expect((await route(out, "/case/f%202/version")).body).toBe(await caseVersion(out, "f 2"));
	});

	it("opens a case's page before the case starts, but nothing else of it", async () => {
		const out = join(folder, "not-yet");
		expect((await route(out, "/")).body).toContain('<ul class="list"></ul>');
		expect((await route(out, "/case/f1")).status).toBe(200);
		expect((await route(out, "/case/f1/session.json")).status).toBe(404);
		expect((await route(out, "/case/..%2Frun.json/version")).status).toBe(404);
		expect((await route(out, "/case/f1/other")).status).toBe(404);
		expect((await route(out, "/elsewhere")).status).toBe(404);
	});

	it("writes a page with the session in it, and needs a case named when the run has more than one", async () => {
		const out = await factsRun(["f1", "f2"]);
		await expect(onlyCase(out)).rejects.toThrow(ViewError);
		const file = join(folder, "f1.html");
		await writeCasePage(out, "f1", file, { facts: viewer });
		const page = await readFile(file, "utf8");
		expect(page).toContain("<title>f1 · switch</title>");
		expect(page).toContain('"session":{');
		expect(page).toContain('"parts":{"facts":{"shade":"dark"}}');
		expect(page).not.toContain('"sessionUrl":"');
		await rm(join(out, "cases", "f2"), { recursive: true });
		expect(await onlyCase(out)).toBe("f1");
	});

	it("tells a case's version by the size of its trace and whether it has a result", async () => {
		const out = await factsRun(["f1"]);
		expect(await caseVersion(out, "f1")).toMatch(/^\d+:true$/);
		expect(await caseVersion(out, "missing")).toBe("0:false");
	});

	it("serves over HTTP, with an error reply when a case cannot be read", async () => {
		const out = await factsRun(["f1"]);
		const server = await serveRun(out, 0);
		const { port } = server.address() as AddressInfo;
		const ok = await fetch(`http://127.0.0.1:${String(port)}/case/f1/version`);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("cache-control")).toBe("no-store");
		await writeFile(join(out, "cases", "f1", "trace.jsonl"), "not json\n");
		const broken = await fetch(`http://127.0.0.1:${String(port)}/case/f1/session.json`);
		expect(broken.status).toBe(500);
		await new Promise((resolve) => server.close(resolve));
		const again = await serveRun(out, port);
		const taken = await serveRun(out, port).catch((error: unknown) => error);
		expect(taken).toBeInstanceOf(Error);
		await new Promise((resolve) => again.close(resolve));
	});
});

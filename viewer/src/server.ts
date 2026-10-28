import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { parseTrace } from "@osolmaz/switch";
import { caseFiles, casesFolder, resultSchema } from "@osolmaz/switch/cli";
import { type DomainViewer, partConfigs, partStyles, viewerScript } from "./bundle.ts";
import { storyOf } from "./frames.ts";
import { indexPage, viewerPage } from "./page.ts";
import type { Session } from "./web/model.ts";

const exists = (path: string): Promise<boolean> =>
	access(path).then(
		() => true,
		() => false,
	);

const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

/** The parts of the viewer that a page can show, by the domain's name. */
export type Viewers = Readonly<Record<string, DomainViewer>>;

interface Reply {
	readonly status: number;
	readonly type: string;
	readonly body: string;
}

/** The viewer cannot show what it was asked for. */
export class ViewerError extends Error {
	override readonly name = "ViewerError";
}

/** The run's cases so far; none before the run has started. */
export async function caseIds(run: string): Promise<string[]> {
	return (await readdir(casesFolder(run)).catch(() => [])).sort();
}

/** The run's only case; a run of more cases needs one named. */
export async function onlyCase(run: string): Promise<string> {
	const ids = await caseIds(run);
	const [id] = ids;
	if (ids.length !== 1 || id === undefined) {
		throw new ViewerError(`the run has ${String(ids.length)} cases; name one with --case`);
	}
	return id;
}

/** A finished case's outcome, and the summary of it that its domain's viewer gives; null before the case finished. */
async function outcomeOf(
	run: string,
	id: string,
	viewers: Viewers,
): Promise<{ outcome: Readonly<Record<string, unknown>> | null; summary: string | null }> {
	const path = caseFiles(run, id).result;
	if (!(await exists(path))) return { outcome: null, summary: null };
	const { domain, outcome } = resultSchema.parse(JSON.parse(await readFile(path, "utf8")));
	const summary = outcome === null ? undefined : viewers[domain]?.summary?.(outcome);
	return { outcome, summary: summary ?? null };
}

/** What changes while a case runs: the size of its trace, and whether its result is written. */
export async function caseVersion(run: string, id: string): Promise<string> {
	const files = caseFiles(run, id);
	const size = await stat(files.trace).then(
		(found) => found.size,
		() => 0,
	);
	return `${String(size)}:${String(await exists(files.result))}`;
}

/** A case as the viewer reads it: its story so far, its outcome and its summary, and whether it has finished. */
export async function caseSession(run: string, id: string, viewers: Viewers = {}): Promise<Session> {
	const version = await caseVersion(run, id);
	const story = storyOf(parseTrace(await readFile(caseFiles(run, id).trace, "utf8")), id);
	const { outcome, summary } = await outcomeOf(run, id, viewers);
	return { story, outcome, summary, finished: version.endsWith(":true"), version };
}

/** The viewer's script with every part's modules, every part's styles, and every part's config. */
async function pageParts(
	viewers: Viewers,
): Promise<{ script: string; styles: string; parts: Record<string, unknown> }> {
	const [script, styles, parts] = await Promise.all([
		viewerScript(Object.values(viewers).flatMap((viewer) => viewer.modules)),
		partStyles(viewers),
		partConfigs(viewers),
	]);
	return { script, styles, parts };
}

/** A case's page with its session in it, which opens without a server. */
export async function savedPage(run: string, id: string, viewers: Viewers = {}): Promise<string> {
	const [session, { script, styles, parts }] = await Promise.all([caseSession(run, id, viewers), pageParts(viewers)]);
	return viewerPage({ title: `${id} · switch`, script, styles, config: { session, parts } });
}

/** Writes a case's page, as it is now, to `file`. */
export async function writeCasePage(run: string, id: string, file: string, viewers: Viewers = {}): Promise<void> {
	await writeFile(file, await savedPage(run, id, viewers));
}

/** A case's page that fetches its session from the server and follows the case while it runs. */
async function livePage(id: string, viewers: Viewers): Promise<string> {
	const base = `/case/${encodeURIComponent(id)}`;
	const { script, styles, parts } = await pageParts(viewers);
	const config = {
		sessionUrl: `${base}/session.json`,
		versionUrl: `${base}/version`,
		indexUrl: "/",
		parts,
	};
	return viewerPage({ title: `${id} · switch`, script, styles, config });
}

async function index(run: string, ids: readonly string[], viewers: Viewers): Promise<Reply> {
	const cases = await Promise.all(
		ids.map(async (id) => ({ id, summary: (await outcomeOf(run, id, viewers)).summary })),
	);
	return { status: 200, type: HTML, body: indexPage(run, cases) };
}

const ROUTES: Readonly<Record<string, (run: string, id: string, viewers: Viewers) => Promise<Reply>>> = {
	"": async (_run, id, viewers) => ({ status: 200, type: HTML, body: await livePage(id, viewers) }),
	"/version": async (run, id) => ({ status: 200, type: TEXT, body: await caseVersion(run, id) }),
	"/session.json": async (run, id, viewers) => ({
		status: 200,
		type: JSON_TYPE,
		body: JSON.stringify(await caseSession(run, id, viewers)),
	}),
};

const NOT_FOUND: Reply = { status: 404, type: TEXT, body: "not found" };

/** The case and the part of it that a path names, such as /case/c1/version. */
function targetOf(path: string): { id: string; part: string } | null {
	const match = /^\/case\/([^/]+)(\/[\w.]+)?$/.exec(path);
	if (match?.[1] === undefined) return null;
	return { id: decodeURIComponent(match[1]), part: match[2] ?? "" };
}

/**
 * The reply to a request: the index at /; at /case/<id> the case's page, its session and its version. A case's page
 * opens before the case starts, and waits for it; the rest needs the case's folder.
 */
export async function route(run: string, url: string, viewers: Viewers = {}): Promise<Reply> {
	const path = new URL(url, "http://localhost").pathname;
	const ids = await caseIds(run);
	if (path === "/") return index(run, ids, viewers);
	const target = targetOf(path);
	const handler = target === null ? undefined : ROUTES[target.part];
	if (target === null || handler === undefined || (target.part !== "" && !ids.includes(target.id))) return NOT_FOUND;
	return handler(run, target.id, viewers);
}

async function replyTo(run: string, url: string, viewers: Viewers): Promise<Reply> {
	try {
		return await route(run, url, viewers);
	} catch (error: unknown) {
		return { status: 500, type: TEXT, body: error instanceof Error ? error.message : String(error) };
	}
}

/** Serves a run's cases on 127.0.0.1 at `port`; resolves once the server listens. */
export function serveRun(run: string, port: number, viewers: Viewers = {}): Promise<Server> {
	const server = viewServer(run, viewers);
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			resolve(server);
		});
	});
}

/** A local server for a run's cases; it reads the run folder on every request, so pages follow running cases. */
export function viewServer(run: string, viewers: Viewers = {}): Server {
	return createServer((request, response) => {
		void replyTo(run, request.url ?? "/", viewers).then((reply) => {
			response.writeHead(reply.status, {
				"content-type": reply.type,
				"cache-control": "no-store",
			});
			response.end(reply.body);
		});
	});
}

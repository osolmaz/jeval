import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { parseTrace } from "../core/index.ts";
import { boardPicture } from "../domains/chess/index.ts";
import { casePage, indexPage, type Picture, plain, storyOf } from "../view/index.ts";
import { caseFiles, casesFolder } from "./layout.ts";
import { exists, resultSchema } from "./runs.ts";

/** The pictures of the domains that draw one, by domain name; the other domains show only their menus. */
const PICTURES: Readonly<Record<string, Picture>> = {
	chess: (seen, options) => boardPicture({ position: seen?.data, options }),
};

const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

interface Reply {
	readonly status: number;
	readonly type: string;
	readonly body: string;
}

export class ViewError extends Error {
	override readonly name = "ViewError";
}

export async function caseIds(run: string): Promise<string[]> {
	return (await readdir(casesFolder(run))).sort();
}

/** The run's only case; a run of more cases needs one named. */
export async function onlyCase(run: string): Promise<string> {
	const ids = await caseIds(run);
	const [id] = ids;
	if (ids.length !== 1 || id === undefined) {
		throw new ViewError(`the run has ${String(ids.length)} cases; name one with --case`);
	}
	return id;
}

async function outcomeOf(run: string, id: string): Promise<Record<string, unknown> | null> {
	const path = caseFiles(run, id).result;
	if (!(await exists(path))) return null;
	return resultSchema.parse(JSON.parse(await readFile(path, "utf8"))).outcome;
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

/** The page of one case. With `live`, the page asks that address for the case's version and reloads on a change. */
export async function renderCase(run: string, id: string, live: string | null): Promise<string> {
	const version = await caseVersion(run, id);
	const story = storyOf(parseTrace(await readFile(caseFiles(run, id).trace, "utf8")));
	return casePage({
		story,
		outcome: await outcomeOf(run, id),
		picture: PICTURES[story.domain],
		live: live === null ? null : { url: live, version },
	});
}

/** Writes the page of one case to `file`, as it is now, to open without a server. */
export async function writeCasePage(run: string, id: string, file: string): Promise<void> {
	await writeFile(file, await renderCase(run, id, null));
}

async function index(run: string, ids: readonly string[]): Promise<Reply> {
	const cases = await Promise.all(
		ids.map(async (id) => {
			const outcome = await outcomeOf(run, id);
			return { id, outcome: outcome === null ? null : plain(Object.values(outcome).slice(0, 2)) };
		}),
	);
	return { status: 200, type: HTML, body: indexPage(run, cases) };
}

/** The reply to a request: the index at /, a case's page at /case/<id>, and its version at /case/<id>/version. */
export async function route(run: string, url: string): Promise<Reply> {
	const path = new URL(url, "http://localhost").pathname;
	const ids = await caseIds(run);
	if (path === "/") return index(run, ids);
	const match = /^\/case\/([^/]+)(\/version)?$/.exec(path);
	const id = match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
	if (id === undefined || !ids.includes(id)) return { status: 404, type: TEXT, body: "not found" };
	if (match?.[2] !== undefined) return { status: 200, type: TEXT, body: await caseVersion(run, id) };
	const live = `/case/${encodeURIComponent(id)}/version`;
	return { status: 200, type: HTML, body: await renderCase(run, id, live) };
}

async function answer(run: string, url: string): Promise<Reply> {
	try {
		return await route(run, url);
	} catch (error: unknown) {
		return { status: 500, type: TEXT, body: error instanceof Error ? error.message : String(error) };
	}
}

/** A local server for a run's cases; it reads the run folder on every request, so pages follow running cases. */
export function viewServer(run: string): Server {
	return createServer((request, response) => {
		void answer(run, request.url ?? "/").then((reply) => {
			response.writeHead(reply.status, { "content-type": reply.type, "cache-control": "no-store" });
			response.end(reply.body);
		});
	});
}

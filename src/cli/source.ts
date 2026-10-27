import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { packageRoot } from "./root.ts";

const run = promisify(execFile);
const ROOT = packageRoot(import.meta.url);

/** The switch code that ran: its package version and, in a Git checkout, its commit and whether it had changes. */
export interface Source {
	readonly version: string;
	readonly commit: string | null;
	readonly changed: boolean | null;
}

export async function switchSource(root = ROOT): Promise<Source> {
	const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
	try {
		const commit = (await run("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
		const status = (await run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"])).stdout;
		return { version, commit, changed: status.trim() !== "" };
	} catch {
		return { version, commit: null, changed: null };
	}
}

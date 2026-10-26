import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

/** The viewer's browser modules, each after the ones it imports. */
const MODULES = ["model", "board", "panels", "app"] as const;
/** An import of one of the other modules: in the one script they share a scope, so the import goes. */
const LOCAL_IMPORT = /^import\s[^;]*?\sfrom\s+"\.\/[\w-]+\.(?:ts|js)";[ \t]*$/gm;
const EXPORT = /^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm;

/**
 * The viewer's browser code as one script, without a bundler: the modules in order, without types, imports and
 * exports. From the sources the types are stripped here; the build in `dist/` already has none.
 */
export async function buildScript(moduleUrl: string = import.meta.url): Promise<string> {
	const typescript = moduleUrl.endsWith(".ts");
	const sources = await Promise.all(
		MODULES.map((name) => readFile(new URL(`./web/${name}.${typescript ? "ts" : "js"}`, moduleUrl), "utf8")),
	);
	return sources
		.map((source) => (typescript ? stripTypeScriptTypes(source) : source))
		.map((code) => code.replace(LOCAL_IMPORT, "").replace(EXPORT, ""))
		.join("\n");
}

let built: Promise<string> | undefined;

/** The viewer's script, built once per process. */
export function viewerScript(): Promise<string> {
	built ??= buildScript();
	return built;
}

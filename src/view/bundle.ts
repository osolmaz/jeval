import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

/** The viewer's own browser modules, each after the ones it imports. */
const MODULES = ["model", "panels", "part", "app"] as const;
/**
 * An import from another module of the script, or from switch's page, which a domain's part imports by the package's
 * name: in the one script they share a scope, so the import goes.
 */
const LOCAL_IMPORT = /^import\s[^;]*?\sfrom\s+"(?:(?:\.{1,2}\/)+[\w./-]+\.(?:ts|js)|@osolmaz\/switch\/page)";[ \t]*$/gm;
const EXPORT = /^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm;

/** A domain's part of the viewer, as the server sees it: its browser modules, its styles and what they start with. */
export interface DomainViewer {
	/** The part's browser modules, each after the ones it uses; the script has them after the viewer's own. */
	readonly modules: readonly URL[];
	/** The part's stylesheets; the page has them after its own styles. */
	readonly styles?: readonly URL[];
	/** The part's config, such as the images it draws with: JSON, so that a saved page needs no other file. */
	config(): Promise<Readonly<Record<string, unknown>>>;
}

/** The browser modules `names` in `folder`, as TypeScript next to a TypeScript module and as JavaScript in a build. */
export function modulesNear(moduleUrl: string, folder: string, names: readonly string[]): URL[] {
	const extension = moduleUrl.endsWith(".ts") ? "ts" : "js";
	return names.map((name) => new URL(`${folder}/${name}.${extension}`, moduleUrl));
}

/** The viewer's own browser modules, next to `moduleUrl`. */
export const viewerModules = (moduleUrl: string = import.meta.url): URL[] => modulesNear(moduleUrl, "./web", MODULES);

/**
 * Browser modules as one script, without a bundler: the modules in order, without types, imports and exports. Types
 * are stripped here from TypeScript sources; the build in `dist/` already has none.
 */
export async function buildScript(modules: readonly URL[]): Promise<string> {
	const sources = await Promise.all(
		modules.map(async (url) => {
			const source = await readFile(url, "utf8");
			return url.pathname.endsWith(".ts") ? stripTypeScriptTypes(source) : source;
		}),
	);
	return sources.map((code) => code.replace(LOCAL_IMPORT, "").replace(EXPORT, "")).join("\n");
}

const built = new Map<string, Promise<string>>();

/** The viewer's script, with the parts' modules after its own, built once per process for each set of parts. */
export function viewerScript(parts: readonly URL[] = []): Promise<string> {
	const modules = [...viewerModules(), ...parts];
	const key = modules.map(String).join(" ");
	let script = built.get(key);
	if (script === undefined) {
		script = buildScript(modules);
		built.set(key, script);
	}
	return script;
}

/** Every part's stylesheets, in the order of the parts, as one text. */
export async function partStyles(viewers: Readonly<Record<string, DomainViewer>>): Promise<string> {
	const files = Object.values(viewers).flatMap((viewer) => viewer.styles ?? []);
	return (await Promise.all(files.map((url) => readFile(url, "utf8")))).join("\n");
}

/** Each part's config by the domain's name, as the page's `parts` config takes them. */
export async function partConfigs(
	viewers: Readonly<Record<string, DomainViewer>>,
): Promise<Record<string, Readonly<Record<string, unknown>>>> {
	const entries = await Promise.all(
		Object.entries(viewers).map(async ([name, viewer]) => [name, await viewer.config()] as const),
	);
	return Object.fromEntries(entries);
}

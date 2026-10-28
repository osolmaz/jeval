import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { type CaseFile, caseSchema, type JudgeCase } from "../case.ts";
import { type Extracted, extractFile } from "./extract.ts";
import { systemTools, type Tools } from "./tools.ts";
import { countWords } from "./units.ts";

/** The rubric of an input folder: `{"items": [{"id", "category", "text"}]}`. */
export const rubricSchema = z.object({
	items: z.array(z.object({ id: z.string(), category: z.string().nullable().optional(), text: z.string() })).min(1),
});

export interface IngestOptions {
	readonly id: string;
	readonly tools?: Tools;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

async function listFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
		.sort();
}

async function safeExtract(
	path: string,
	bytes: Uint8Array,
	tools: Tools,
): Promise<Extracted & { error: string | null }> {
	try {
		return { ...(await extractFile(path, bytes, tools)), error: null };
	} catch (error: unknown) {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		return { format: "other", units: [], pictures: [], formatting: null, marks: 0, error: message.slice(0, 300) };
	}
}

/** Where a file comes from in the input folder and what it becomes in the case. */
interface Source {
	readonly file: string;
	readonly path: string;
	readonly role: CaseFile["role"];
	readonly id: string;
}

const ROLES = [
	{ folder: "answer", prefix: "output", role: "answer", id: "a" },
	{ folder: "documents", prefix: "documents", role: "document", id: "d" },
] as const;

async function sources(input: string): Promise<Source[]> {
	const found: Source[] = [];
	for (const { folder, prefix, role, id } of ROLES) {
		for (const [index, name] of (await listFiles(join(input, folder))).entries()) {
			found.push({
				file: join(input, folder, name),
				path: `${prefix}/${name}`,
				role,
				id: `${id}${String(index + 1)}`,
			});
		}
	}
	return found;
}

async function caseFile(source: Source, output: string, tools: Tools): Promise<CaseFile> {
	const bytes = new Uint8Array(await readFile(source.file));
	const extracted = await safeExtract(source.path, bytes, tools);
	const renders = [];
	for (const [index, picture] of extracted.pictures.entries()) {
		const name = `images/${source.id}-${String(index + 1)}.${EXTENSIONS[picture.mimeType] ?? "png"}`;
		await writeFile(join(output, name), picture.bytes);
		renders.push({ label: picture.label, path: name, mimeType: picture.mimeType });
	}
	const { format, units, formatting, marks, error } = extracted;
	return {
		id: source.id,
		path: source.path,
		role: source.role,
		format,
		units,
		words: countWords(units),
		renders,
		formatting,
		marks,
		error,
	};
}

/**
 * Turns an input folder into a case folder. The input holds `request.md`, `rubric.json`, the task's files under
 * `documents/` and the answer's files under `answer/`; the case folder gets `case.json` and the images it refers to.
 */
export async function ingestCase(input: string, output: string, options: IngestOptions): Promise<JudgeCase> {
	const tools = options.tools ?? systemTools;
	const request = await readFile(join(input, "request.md"), "utf8");
	const rubric = rubricSchema.parse(JSON.parse(await readFile(join(input, "rubric.json"), "utf8")));
	await mkdir(join(output, "images"), { recursive: true });
	const files: CaseFile[] = [];
	for (const source of await sources(input)) files.push(await caseFile(source, output, tools));
	const items = rubric.items.map((item) => ({ id: item.id, category: item.category ?? null, text: item.text }));
	const judgeCase = caseSchema.parse({ schema: 1, id: options.id, request, items, files });
	await writeFile(join(output, "case.json"), `${JSON.stringify(judgeCase, null, 1)}\n`);
	return judgeCase;
}

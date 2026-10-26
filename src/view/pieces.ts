import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../core/index.ts";

/** The chess pieces the viewer draws: Chessnut by Alexis Luengas, under the Apache License 2.0. */
const FOLDER = join(packageRoot(import.meta.url), "assets", "pieces", "chessnut");
const NAMES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"] as const;

let read: Promise<Record<string, string>> | undefined;

/** Each piece's image as a data URL, by name such as wK or bQ, so that a saved page needs no other file. */
export function pieceImages(): Promise<Record<string, string>> {
	read ??= Promise.all(
		NAMES.map(async (name) => {
			const svg = await readFile(join(FOLDER, `${name}.svg`));
			return [name, `data:image/svg+xml;base64,${svg.toString("base64")}`] as const;
		}),
	).then((entries) => Object.fromEntries(entries));
	return read;
}

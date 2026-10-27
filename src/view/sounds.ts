import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../core/index.ts";
import type { SoundKind, SoundSet } from "./web/sound.ts";

/** The board's sound clips: short percussive recordings in the public domain; their README describes each one. */
const FOLDER = join(packageRoot(import.meta.url), "assets", "sounds");

/**
 * The clips each event plays, by file name; a list plays its clips one after another. The numbers in the file names
 * follow the source recording and mean nothing, so this table alone decides how each event sounds: reorder it freely
 * after listening.
 */
export const SOUND_SET: Readonly<Record<SoundKind, readonly string[]>> = {
	// A low, full knock.
	move: ["10.wav"],
	// The loudest mid clip, harder than a move.
	capture: ["12.wav"],
	// Two similar low knocks: the king, then the rook.
	castle: ["10.wav", "01.wav"],
	// The brightest click, unlike any move.
	check: ["08.wav"],
	// The longest low clip.
	end: ["11.wav"],
};

let read: Promise<SoundSet> | undefined;

/** The clips that `SOUND_SET` names, each once as a data URL so that a saved page needs no other file, and the table. */
export function soundSet(): Promise<SoundSet> {
	read ??= Promise.all(
		[...new Set(Object.values(SOUND_SET).flat())].map(async (file) => {
			const wav = await readFile(join(FOLDER, file));
			return [file, `data:audio/wav;base64,${wav.toString("base64")}`] as const;
		}),
	).then((clips) => ({ clips: Object.fromEntries(clips), events: SOUND_SET }));
	return read;
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../core/index.ts";
import type { SoundKind, SoundSet } from "./web/sound.ts";

/** The board's sound clips: short percussive recordings in the public domain; their README describes each one. */
const FOLDER = join(packageRoot(import.meta.url), "assets", "sounds");

/** The clip each event plays, by the file named after the event. Change a file here and nowhere else. */
export const SOUND_SET: Readonly<Record<SoundKind, string>> = {
	"game-start": "game-start.wav",
	move: "move.wav",
	castling: "castling.wav",
	capture: "capture.wav",
	check: "check.wav",
	checkmate: "checkmate.wav",
	stalemate: "stalemate.wav",
	"game-over": "game-over.wav",
};

let read: Promise<SoundSet> | undefined;

/** The clips that `SOUND_SET` names, each once as a data URL so that a saved page needs no other file, and the table. */
export function soundSet(): Promise<SoundSet> {
	read ??= Promise.all(
		[...new Set(Object.values(SOUND_SET))].map(async (file) => {
			const wav = await readFile(join(FOLDER, file));
			return [file, `data:audio/wav;base64,${wav.toString("base64")}`] as const;
		}),
	).then((clips) => ({ clips: Object.fromEntries(clips), events: SOUND_SET }));
	return read;
}

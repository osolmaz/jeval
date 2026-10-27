import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../../core/index.ts";
import { type DomainViewer, modulesNear } from "../../view/index.ts";
import type { SoundKind, SoundSet } from "./web/sound.ts";

/**
 * The chess part's files beside the package, so that they are found the same way from the sources and from the build:
 * the pieces, cburnett by Colin M.L. Burnett, the set lichess shows by default, under the BSD license; and the board's
 * sound clips, short percussive recordings in the public domain, which their README describes.
 */
const ASSETS = join(packageRoot(import.meta.url), "src", "domains", "chess", "assets");
const PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"] as const;

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

let pieces: Promise<Record<string, string>> | undefined;
let sounds: Promise<SoundSet> | undefined;

/** Each piece's image as a data URL, by name such as wK or bQ, so that a saved page needs no other file. */
export function pieceImages(): Promise<Record<string, string>> {
	pieces ??= Promise.all(
		PIECES.map(async (name) => {
			const svg = await readFile(join(ASSETS, "pieces", "cburnett", `${name}.svg`));
			return [name, `data:image/svg+xml;base64,${svg.toString("base64")}`] as const;
		}),
	).then((entries) => Object.fromEntries(entries));
	return pieces;
}

/** The clips that `SOUND_SET` names, each once as a data URL so that a saved page needs no other file, and the table. */
export function soundSet(): Promise<SoundSet> {
	sounds ??= Promise.all(
		[...new Set(Object.values(SOUND_SET))].map(async (file) => {
			const wav = await readFile(join(ASSETS, "sounds", file));
			return [file, `data:audio/wav;base64,${wav.toString("base64")}`] as const;
		}),
	).then((clips) => ({ clips: Object.fromEntries(clips), events: SOUND_SET }));
	return sounds;
}

/** The chess part's browser modules in `web/`, each after the ones it uses. */
export const chessModules = (moduleUrl: string = import.meta.url): URL[] =>
	modulesNear(moduleUrl, "./web", ["data", "model", "board", "sound", "panels", "part"]);

/** The chess part of the viewer: the board, the players' bars, the move list, the sounds and the PGN download. */
export const chessViewer: DomainViewer = {
	modules: chessModules(),
	config: async () => ({ pieces: await pieceImages(), sounds: await soundSet() }),
};

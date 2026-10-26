import { Chess, type Color, type Move, type PieceSymbol } from "chess.js";
import { z } from "zod";
import type { Entry, JsonObject } from "../../core/index.ts";
import type { ChessCase } from "./case.ts";

export type Status =
	"playing" | "checkmate" | "stalemate" | "threefold repetition" | "insufficient material" | "fifty-move rule";

export const PIECE_NAMES: Readonly<Record<PieceSymbol, string>> = {
	p: "pawn",
	n: "knight",
	b: "bishop",
	r: "rook",
	q: "queen",
	k: "king",
};

const PIECE_VALUES: Readonly<Record<PieceSymbol, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** What each step records about the game, for the next step and for the viewer. */
export const stepSchema = z.object({
	you: z.enum(["white", "black"]),
	/** The moves of this step, in long algebraic notation such as e2e4 or a7a8q. */
	moves: z.array(z.string()),
	san: z.array(z.string()),
	/** The position after the step. */
	fen: z.string(),
	status: z.string(),
	check: z.boolean(),
});
export type Step = z.infer<typeof stepSchema>;

export const colorOf = (side: ChessCase["side"]): Color => (side === "white" ? "w" : "b");

/** The game after `moves`, given in long algebraic notation, from `start`. */
export function replay(start: string, moves: readonly string[]): Chess {
	const game = new Chess(start);
	for (const move of moves) game.move(move);
	return game;
}

/** Every move played so far, from the steps in the log. */
export function movesOf(log: readonly Entry[]): string[] {
	return log.flatMap((entry) => stepSchema.safeParse(entry.observation.data).data?.moves ?? []);
}

export function statusOf(game: Chess): Status {
	if (game.isCheckmate()) return "checkmate";
	if (game.isStalemate()) return "stalemate";
	if (game.isThreefoldRepetition()) return "threefold repetition";
	if (game.isInsufficientMaterial()) return "insufficient material";
	if (game.isDrawByFiftyMoves()) return "fifty-move rule";
	return "playing";
}

/** A number from 0 up to 1 that depends only on `text`: an FNV-1a hash, mixed by one mulberry32 step. */
export function unitOf(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	let mixed = (hash + 0x6d2b79f5) | 0;
	mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
	mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
	return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
}

/** The opponent's move: a legal move picked at random, the same one every time for the same seed and moves. */
export function opponentMove(game: Chess, seed: number, moves: readonly string[]): Move | undefined {
	const legal = game.moves({ verbose: true });
	return legal[Math.floor(unitOf(`${String(seed)}:${moves.join(" ")}`) * legal.length)];
}

/** The step record of `played` moves, which leave `game` where it is now. */
export function stepOf(side: ChessCase["side"], game: Chess, played: readonly Move[]): Step & JsonObject {
	return {
		you: side,
		moves: played.map((move) => move.lan),
		san: played.map((move) => move.san),
		fen: game.fen(),
		status: statusOf(game),
		check: game.isCheck(),
	};
}

/** The points of material each side has: pawn 1, knight and bishop 3, rook 5, queen 9. */
export function materialOf(game: Chess): Record<"white" | "black", number> {
	const sum = { white: 0, black: 0 };
	for (const square of game.board().flat()) {
		if (square !== null) sum[square.color === "w" ? "white" : "black"] += PIECE_VALUES[square.type];
	}
	return sum;
}

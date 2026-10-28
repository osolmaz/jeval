import { Chess, type Color, type Move, type PieceSymbol } from "chess.js";
import type { ChessCase, ChessGame } from "./case.ts";
import type { ChessState } from "./web/data.ts";

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

export const colorOf = (side: ChessCase["side"]): Color => (side === "white" ? "w" : "b");
export const nameOf = (color: Color): "white" | "black" => (color === "w" ? "white" : "black");

/** The side the model plays, as its state records it: both sides in self-play. */
export const youOf = (game: ChessCase): ChessState["you"] => (game.opponent === "self" ? "both" : game.side);

/** The game after `moves`, given in long algebraic notation, from `start`. */
export function gameAfter(start: string, moves: readonly string[]): Chess {
	const game = new Chess(start);
	for (const move of moves) game.move(move);
	return game;
}

/** The board of a state: its moves played from its start, so that chess.js also sees a repeated position. */
export const boardOf = (state: ChessState): Chess => gameAfter(state.start, state.moves);

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

/** The engine failed: it is missing, did not start, or stopped before it replied. */
export class EngineError extends Error {
	override readonly name = "EngineError";
}

/** The opponent's move in long algebraic notation: a random legal one or the engine's; none in self-play. */
export function replyOf(game: ChessGame, board: Chess, moves: readonly string[]): Promise<string | undefined> {
	if (game.opponent === "self") return Promise.resolve(undefined);
	if (game.opponent === "random") return Promise.resolve(opponentMove(board, game.seed, moves)?.lan);
	if (game.engine === undefined) return Promise.reject(new EngineError("the game plays Stockfish but has no engine"));
	return game.engine.move(board.fen());
}

/** The opponent as the state names it, for the viewer. */
export function opponentName(game: ChessGame): string {
	if (game.opponent === "self") return "itself";
	if (game.opponent === "random") return `random legal moves, seed ${String(game.seed)}`;
	return `${game.engine?.name ?? "Stockfish"}, ${String(game.movetime / 1000)} s a move`;
}

/** The state after `played` moves, which leave `board` where it is now; `last` says in words what the step did. */
export function stateAfter(state: ChessState, board: Chess, played: readonly Move[], last: string): ChessState {
	return {
		...state,
		moves: [...state.moves, ...played.map((move) => move.lan)],
		san: [...state.san, ...played.map((move) => move.san)],
		fen: board.fen(),
		status: statusOf(board),
		check: board.isCheck(),
		last,
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

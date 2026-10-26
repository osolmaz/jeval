import { Chess } from "chess.js";
import type { Domain, Entry, JsonObject, Limits } from "../../core/index.ts";
import type { ChessCase } from "./case.ts";
import { colorOf, materialOf, movesOf, opponentMove, replay, statusOf, stepOf } from "./game.ts";
import { move } from "./move.ts";
import { chessView } from "./view.ts";

/** One step is one move of the model; a position never has more than 218 legal moves, so every one fits a menu. */
export const LIMITS: Limits = { steps: 100, options: 220, windowShare: 0.9 };

/** The first observation: the start position, after the opponent's first move when the opponent is to move. */
function opening(game: ChessCase): Promise<readonly Entry[]> {
	const board = new Chess(game.start);
	const first = board.turn() === colorOf(game.side) ? undefined : opponentMove(board, game.seed, []);
	if (first !== undefined) board.move(first.lan);
	const text = `The game starts. You play ${game.side}.${first === undefined ? "" : ` The opponent played ${first.san}.`}`;
	const opponent = `random legal moves, seed ${String(game.seed)}`;
	const data = { ...stepOf(game.side, board, first === undefined ? [] : [first]), opponent, start: game.start };
	return Promise.resolve([{ action: "start", key: "start", observation: { source: "board", text, data } }]);
}

/** Plays a game of chess against an opponent that picks random legal moves; the model picks each of its moves. */
export const chess: Domain<ChessCase> = {
	name: "chess",
	version: "0.1.0",
	actions: [move],
	stop: "Resign the game",
	choose: "Choose your next move. Win material, attack the opponent's king, and keep your own pieces safe.",
	questions: () => [],
	start: opening,
	view: (state, _purpose, tokens) => chessView(state, tokens),
};

/** How the game ended: a win, loss or draw with its reason, or unfinished at the move limit; and the material. */
export function outcomeOf(game: ChessCase, log: readonly Entry[], resigned: boolean): JsonObject {
	const board = replay(game.start, movesOf(log));
	const status = statusOf(board);
	const material = materialOf(board);
	const common = { moves: board.history().length, material, fen: board.fen() };
	if (resigned) return { result: "loss", reason: "resignation", ...common };
	if (status === "checkmate") {
		return { result: board.turn() === colorOf(game.side) ? "loss" : "win", reason: status, ...common };
	}
	if (status !== "playing") return { result: "draw", reason: status, ...common };
	return { result: "unfinished", reason: "move limit", ...common };
}

export { type ChessCase, caseSchema, STANDARD_START } from "./case.ts";

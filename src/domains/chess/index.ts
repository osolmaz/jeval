import { Chess } from "chess.js";
import type { Domain, Entry, JsonObject, Limits } from "../../core/index.ts";
import type { ChessCase, ChessGame } from "./case.ts";
import {
	colorOf,
	materialOf,
	movesOf,
	opponentName,
	replay,
	replyOf,
	type Status,
	statusOf,
	stepOf,
	youOf,
} from "./game.ts";
import { move } from "./move.ts";
import { chessView } from "./view.ts";

/**
 * One step is one move of the model: against an opponent a move and its reply, in self-play one move of either side.
 * A position never has more than 218 legal moves, so every one fits a menu.
 */
export const LIMITS: Limits = { steps: 200, options: 220, windowShare: 0.9 };

/** The first observation: the start position, after the opponent's first move when it is to move. */
async function opening(game: ChessGame): Promise<readonly Entry[]> {
	const board = new Chess(game.start);
	const waits = game.opponent === "self" || board.turn() === colorOf(game.side);
	const answer = waits ? undefined : await replyOf(game, board, []);
	const first = answer === undefined ? undefined : board.move(answer);
	const plays = game.opponent === "self" ? "You play both sides." : `You play ${game.side}.`;
	const text = `The game starts. ${plays}${first === undefined ? "" : ` The opponent played ${first.san}.`}`;
	const data = {
		...stepOf(youOf(game), board, first === undefined ? [] : [first]),
		opponent: opponentName(game),
		start: game.start,
	};
	return [{ action: "start", key: "start", observation: { source: "board", text, data } }];
}

/** Plays a game of chess against an opponent that picks random legal moves, against Stockfish, or against itself. */
export const chess: Domain<ChessGame> = {
	name: "chess",
	version: "0.3.0",
	actions: [move],
	stop: "Resign the game",
	choose: "Choose your next move. Win material, attack the opponent's king, and keep your own pieces safe.",
	questions: () => [],
	start: opening,
	view: (state, _purpose, tokens) => chessView(state, tokens),
};

/** The result in self-play, where the side that did not have to move won a checkmate or a resignation. */
function selfResult(board: Chess, status: Status, resigned: boolean): { result: string; reason: string } {
	const winner = `${board.turn() === "w" ? "black" : "white"} wins`;
	if (resigned) return { result: winner, reason: "resignation" };
	if (status === "checkmate") return { result: winner, reason: status };
	return status === "playing" ? { result: "unfinished", reason: "move limit" } : { result: "draw", reason: status };
}

/** The result for the model against an opponent: a win, a loss, a draw, or unfinished at the move limit. */
function modelResult(
	game: ChessCase,
	board: Chess,
	status: Status,
	resigned: boolean,
): { result: string; reason: string } {
	if (resigned) return { result: "loss", reason: "resignation" };
	if (status === "checkmate") return { result: board.turn() === colorOf(game.side) ? "loss" : "win", reason: status };
	return status === "playing" ? { result: "unfinished", reason: "move limit" } : { result: "draw", reason: status };
}

/**
 * How the game ended, with its reason, the number of moves both sides made, the material and the final position.
 * Against an opponent the result is the model's: win, loss or draw. In self-play it names the winner: white
 * wins or black wins, or a draw. A game the move limit cut is unfinished.
 */
export function outcomeOf(game: ChessCase, log: readonly Entry[], resigned: boolean): JsonObject {
	const board = replay(game.start, movesOf(log));
	const status = statusOf(board);
	const ending =
		game.opponent === "self" ? selfResult(board, status, resigned) : modelResult(game, board, status, resigned);
	return { ...ending, moves: board.history().length, material: materialOf(board), fen: board.fen() };
}

export { type ChessCase, type ChessGame, caseSchema, type Engine, STANDARD_START } from "./case.ts";
export { EngineError } from "./game.ts";

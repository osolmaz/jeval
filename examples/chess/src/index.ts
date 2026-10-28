import { Chess } from "chess.js";
import type { DomainShared, Ending, JsonObject, Limits, StateMachine } from "@osolmaz/switch";
import type { ChessCase, ChessGame } from "./case.ts";
import {
	boardOf,
	colorOf,
	materialOf,
	opponentName,
	replyOf,
	stateAfter,
	type Status,
	statusOf,
	youOf,
} from "./game.ts";
import { type MoveChoice, movesIn, play } from "./move.ts";
import { chessView } from "./view.ts";
import type { ChessState } from "./web/data.ts";

/**
 * One step is one move of the model: against an opponent a move and its reply, in self-play one move of either side.
 * A position never has more than 218 legal moves, so every one fits among the choices.
 */
export const LIMITS: Limits = { steps: 200, choices: 220, windowShare: 0.9 };

/** What every game shares: the domain's name and version, the two texts of the pick question, and the limits. */
export const CHESS: DomainShared = {
	name: "chess",
	version: "0.5.0",
	stop: "Resign the game",
	instructions: "Choose your next move. Win material, attack the opponent's king, and keep your own pieces safe.",
	limits: LIMITS,
};

/** The initial state: the start position, after the opponent's first move when it is to move. */
async function opening(game: ChessGame): Promise<ChessState> {
	const board = new Chess(game.start);
	const waits = game.opponent === "self" || board.turn() === colorOf(game.side);
	const answer = waits ? undefined : await replyOf(game, board, []);
	const first = answer === undefined ? undefined : board.move(answer);
	const plays = game.opponent === "self" ? "You play both sides." : `You play ${game.side}.`;
	const text = `The game starts. ${plays}${first === undefined ? "" : ` The opponent played ${first.san}.`}`;
	const before: ChessState = {
		you: youOf(game),
		opponent: opponentName(game),
		start: game.start,
		moves: [],
		san: [],
		fen: game.start,
		status: "playing",
		check: false,
		last: "",
	};
	return stateAfter(before, board, first === undefined ? [] : [first], text);
}

/** The state machine of one game: against an opponent that picks random legal moves, against Stockfish, or itself. */
export function chessMachine(game: ChessGame): StateMachine<ChessState, MoveChoice> {
	return {
		initial: () => opening(game),
		choices: movesIn,
		transition: (state, choice) => play(game, state, choice.lan),
		view: (state, _purpose, tokens, charsPerToken) => Promise.resolve(chessView(state, tokens, charsPerToken)),
	};
}

/** A game that is still on: the steps ran out at the step limit, or a pick failed. */
const unfinished = (ended: Ending): { result: string; reason: string } => ({ result: "unfinished", reason: ended });

/** The result in self-play, where the side that did not have to move won a checkmate or a resignation. */
function selfResult(board: Chess, status: Status, ended: Ending): { result: string; reason: string } {
	const winner = `${board.turn() === "w" ? "black" : "white"} wins`;
	if (ended === "stop") return { result: winner, reason: "resignation" };
	if (status === "checkmate") return { result: winner, reason: status };
	return status === "playing" ? unfinished(ended) : { result: "draw", reason: status };
}

/** The result for the model against an opponent: a win, a loss, a draw, or unfinished. */
function modelResult(
	side: ChessCase["side"],
	board: Chess,
	status: Status,
	ended: Ending,
): { result: string; reason: string } {
	if (ended === "stop") return { result: "loss", reason: "resignation" };
	if (status === "checkmate") return { result: board.turn() === colorOf(side) ? "loss" : "win", reason: status };
	return status === "playing" ? unfinished(ended) : { result: "draw", reason: status };
}

/**
 * How the game ended, from its last state and why its steps ended: the result with its reason, the number of moves
 * both sides made, the material and the final position. Stop is a resignation. Against an opponent the result is the
 * model's: win, loss or draw. In self-play it names the winner: white wins or black wins, or a draw. A game that the
 * step limit or a failed pick cut is unfinished, with that as its reason.
 */
export function outcomeOf(state: ChessState, ended: Ending): JsonObject {
	const board = boardOf(state);
	const status = statusOf(board);
	const ending =
		state.you === "both" ? selfResult(board, status, ended) : modelResult(state.you, board, status, ended);
	return { ...ending, moves: board.history().length, material: materialOf(board), fen: board.fen() };
}

export { type ChessCase, type ChessGame, caseSchema, type Engine, STANDARD_START } from "./case.ts";
export { EngineError } from "./game.ts";
export type { MoveChoice } from "./move.ts";
export type { ChessState } from "./web/data.ts";

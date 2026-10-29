import { Chess } from "chess.js";
import {
	definitionOf,
	type DomainShared,
	type Ending,
	type JsonObject,
	type Limits,
	limitsJson,
	picking,
	type RunResult,
	type StateMachine,
} from "@osolmaz/switch";
import type { ChessCase, ChessGame } from "./case.ts";
import { boardOf, colorOf, materialOf, opponentName, replyOf, stateAfter, youOf } from "./game.ts";
import { movesIn, play, RESIGNATION, resigned } from "./move.ts";
import { chessView } from "./view.ts";
import type { ChessState } from "./web/data.ts";

/**
 * One step is one move of the model: against an opponent a move and its reply, in self-play one move of either side.
 * The game ends the run, so the step limit is only a safety net.
 */
export const LIMITS: Limits = { steps: 200, windowShare: 0.9 };

/**
 * The texts of the pick, and the most choices that it shows: a position never has more than 218 legal moves, so every
 * move fits, with resigning.
 */
export const TEXTS = {
	instructions: "Choose your next move. Win material, attack the opponent's king, and keep your own pieces safe.",
	resign: "Resign the game",
	choices: 220,
} as const;

/** What every game shares: the domain's name and version, its limits, and its definition: the texts and the limits. */
export const CHESS: DomainShared = {
	name: "chess",
	version: "0.6.0",
	limits: LIMITS,
	definition: definitionOf("chess", { ...TEXTS, limits: limitsJson(LIMITS) }),
};

/** The initial state: the start position, after the opponent's first move when it is to move. */
async function opening(game: ChessGame): Promise<ChessState> {
	const board = new Chess(game.start);
	const waits = game.opponent === "self" || board.turn() === colorOf(game.side);
	const theirs = waits ? undefined : await replyOf(game, board, []);
	const first = theirs === undefined ? undefined : board.move(theirs);
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

/**
 * The state machine of one game, against an opponent that picks random legal moves, against Stockfish, or itself: one
 * pick in each position, of a move or resigning, until the game is over.
 */
export function chessMachine(game: ChessGame): StateMachine<ChessState> {
	return {
		initial: () => opening(game),
		...picking({
			instructions: TEXTS.instructions,
			limit: TEXTS.choices,
			choices: (state) => movesIn(state, TEXTS.resign),
			transition: (state, choice) =>
				choice.type === "resign" ? Promise.resolve(resigned(game, state)) : play(game, state, choice.lan),
		}),
		view: (state, tokens, charsPerToken) => Promise.resolve(chessView(state, tokens, charsPerToken)),
	};
}

/** A game that is still on: the step limit cut it, or a request failed. */
const unfinished = (ended: Ending): { result: string; reason: string } => ({ result: "unfinished", reason: ended });

/** The result in self-play, where the side that did not have to move won a checkmate or a resignation. */
function selfResult(board: Chess, status: string, ended: Ending): { result: string; reason: string } {
	const winner = `${board.turn() === "w" ? "black" : "white"} wins`;
	if (status === RESIGNATION || status === "checkmate") return { result: winner, reason: status };
	return status === "playing" ? unfinished(ended) : { result: "draw", reason: status };
}

/** The result for the model against an opponent: a win, a loss, a draw, or unfinished. */
function modelResult(
	side: ChessCase["side"],
	board: Chess,
	status: string,
	ended: Ending,
): { result: string; reason: string } {
	if (status === RESIGNATION) return { result: "loss", reason: status };
	if (status === "checkmate") return { result: board.turn() === colorOf(side) ? "loss" : "win", reason: status };
	return status === "playing" ? unfinished(ended) : { result: "draw", reason: status };
}

/**
 * How the game ended, from the run's result: its last state and why the run ended. The result with its reason, the
 * number of moves both sides made, the material and the final position. Against an opponent the result is the
 * model's: win, loss or draw. In self-play it names the winner: white wins or black wins, or a draw. A game that the
 * step limit or a failed request cut is unfinished, with that as its reason.
 */
export function outcomeOf({ state, ended }: Pick<RunResult<ChessState>, "state" | "ended">): JsonObject {
	const board = boardOf(state);
	const ending =
		state.you === "both"
			? selfResult(board, state.status, ended)
			: modelResult(state.you, board, state.status, ended);
	return { ...ending, moves: board.history().length, material: materialOf(board), fen: board.fen() };
}

export { type ChessCase, type ChessGame, caseSchema, type Engine, STANDARD_START } from "./case.ts";
export { EngineError } from "./game.ts";
export type { MoveChoice, ResignChoice } from "./move.ts";
export type { ChessState } from "./web/data.ts";

import type { Move } from "chess.js";
import type { Choice } from "@osolmaz/switch";
import type { ChessGame } from "./case.ts";
import { boardOf, nameOf, PIECE_NAMES, replyOf, stateAfter, statusOf } from "./game.ts";
import type { ChessState } from "./web/data.ts";

/** A move among the choices, with the move in long algebraic notation for the transition. */
export interface MoveChoice extends Choice {
	readonly lan: string;
}

function castling(move: Move): string | undefined {
	if (move.isKingsideCastle()) return "castle kingside";
	return move.isQueensideCastle() ? "castle queenside" : undefined;
}

/** The text the model reads for a move: its SAN, then in words what moves where and what it takes. */
export function describe(move: Move): string {
	const details = [castling(move) ?? `${PIECE_NAMES[move.piece]} ${move.from} to ${move.to}`];
	if (move.captured !== undefined) details.push(`takes the ${PIECE_NAMES[move.captured]}`);
	if (move.promotion !== undefined) details.push(`becomes a ${PIECE_NAMES[move.promotion]}`);
	if (move.san.endsWith("#")) details.push("checkmate");
	else if (move.san.endsWith("+")) details.push("check");
	return `${move.san} (${details.join(", ")})`;
}

const STATUS_TEXTS: Readonly<Record<string, string>> = {
	checkmate: "Checkmate: the game is over.",
	stalemate: "Stalemate: the game is a draw.",
	"threefold repetition": "The same position came up three times: the game is a draw.",
	"insufficient material": "Neither side can checkmate: the game is a draw.",
	"fifty-move rule": "Fifty moves passed without a capture or a pawn move: the game is a draw.",
};

/** Who played a move, in the words of the state: you against an opponent, the side's color in self-play. */
function mover(game: ChessGame, color: "w" | "b"): string {
	if (game.opponent !== "self") return "You";
	return nameOf(color) === "white" ? "White" : "Black";
}

/** The choice function: the legal moves of the state's position; none once the game is over, which ends the case. */
export function movesIn(state: ChessState): MoveChoice[] {
	const board = boardOf(state);
	if (statusOf(board) !== "playing") return [];
	return board.moves({ verbose: true }).map((legal) => ({
		type: "move",
		key: `move:${String(state.moves.length)}:${legal.lan}`,
		text: describe(legal),
		lan: legal.lan,
		data: { from: legal.from, to: legal.to, san: legal.san },
	}));
}

/** The transition function: the model's move and, against an opponent while the game goes on, the opponent's reply. */
export async function play(game: ChessGame, state: ChessState, lan: string): Promise<ChessState> {
	const board = boardOf(state);
	const who = mover(game, board.turn());
	const ours = board.move(lan);
	const theirs = statusOf(board) === "playing" ? await replyOf(game, board, [...state.moves, ours.lan]) : undefined;
	const reply = theirs === undefined ? undefined : board.move(theirs);
	const text = [
		`${who} played ${ours.san}.`,
		reply === undefined ? "" : `The opponent played ${reply.san}.`,
		STATUS_TEXTS[statusOf(board)] ?? "",
	];
	const played = reply === undefined ? [ours] : [ours, reply];
	return stateAfter(state, board, played, text.filter((part) => part !== "").join(" "));
}

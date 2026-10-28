import type { Chess } from "chess.js";
import type { JsonObject, View } from "@osolmaz/switch";
import { boardOf, colorOf, nameOf } from "./game.ts";
import type { ChessState } from "./web/data.ts";

const LEGEND =
	"Capital letters are white pieces and small letters black pieces: K king, Q queen, R rook, B bishop, N knight, P pawn. A dot is an empty square.";
/** How many of the latest moves stay in the view when the whole game does not fit. */
const RECENT = 20;
const CHARS_PER_TOKEN = 3;

/** The board as text, rank 8 at the top, with the files under it. */
function boardRows(board: Chess): string[] {
	const rows = board.board().map((rank, index) => {
		const squares = rank.map((square) => {
			if (square === null) return ".";
			return square.color === "w" ? square.type.toUpperCase() : square.type;
		});
		return `${String(8 - index)} ${squares.join(" ")}`;
	});
	return [...rows, "  a b c d e f g h"];
}

/** Each side's pieces, such as Ke1 for the king on e1. */
function pieces(board: Chess, color: "w" | "b"): string[] {
	return board
		.board()
		.flat()
		.flatMap((square) => (square?.color === color ? [`${square.type.toUpperCase()}${square.square}`] : []));
}

/** The moves so far with their numbers, such as "1. e4 e5 2. Nf3"; the start position gives the first number. */
export function numbered(start: string, san: readonly string[]): string[] {
	const fields = start.split(" ");
	const blackFirst = fields[1] === "b";
	const first = Number(fields[5] ?? "1");
	return san.map((move, index) => {
		const ply = index + (blackFirst ? 1 : 0);
		const number = String(first + Math.floor(ply / 2));
		if (ply % 2 === 0) return `${number}. ${move}`;
		return index === 0 ? `${number}... ${move}` : move;
	});
}

/** The position the model picks a move in, with as many earlier moves as fit `tokens`. */
export function chessView(state: ChessState, tokens: number): View {
	const board = boardOf(state);
	// In self-play the model plays the side to move.
	const mine = state.you === "both" ? board.turn() : colorOf(state.you);
	const moves = numbered(state.start, board.history());
	const base: JsonObject = {
		you: nameOf(mine),
		to_move: board.turn() === "w" ? "white" : "black",
		board: boardRows(board),
		legend: LEGEND,
		your_pieces: pieces(board, mine),
		opponent_pieces: pieces(board, mine === "w" ? "b" : "w"),
		in_check: board.isCheck(),
		last_step: state.last,
		fen: board.fen(),
	};
	const whole = { ...base, moves: moves.join(" ") };
	if (JSON.stringify(whole).length / CHARS_PER_TOKEN <= tokens || moves.length <= RECENT) {
		return { json: whole, images: [], omitted: [] };
	}
	return {
		json: { ...base, moves: `… ${moves.slice(-RECENT).join(" ")}` },
		images: [],
		omitted: [`the first ${String(moves.length - RECENT)} moves of the game`],
	};
}

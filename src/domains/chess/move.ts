import type { Move } from "chess.js";
import { action, type Observation } from "../../core/index.ts";
import type { ChessGame } from "./case.ts";
import { movesOf, nameOf, PIECE_NAMES, replay, replyOf, stepOf, statusOf, youOf } from "./game.ts";

interface Play {
	/** Every move played before this one. */
	readonly before: readonly string[];
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

/** Who played a move, in the words of the step: you against an opponent, the side's color in self-play. */
function mover(game: ChessGame, color: "w" | "b"): string {
	if (game.opponent !== "self") return "You";
	return nameOf(color) === "white" ? "White" : "Black";
}

/** Plays the model's move and, against an opponent while the game goes on, the opponent's reply. */
async function play(game: ChessGame, { before, lan }: Play): Promise<Observation> {
	const board = replay(game.start, before);
	const who = mover(game, board.turn());
	const ours = board.move(lan);
	const answer = statusOf(board) === "playing" ? await replyOf(game, board, [...before, ours.lan]) : undefined;
	const reply = answer === undefined ? undefined : board.move(answer);
	const text = [
		`${who} played ${ours.san}.`,
		reply === undefined ? "" : `The opponent played ${reply.san}.`,
		STATUS_TEXTS[statusOf(board)] ?? "",
	];
	return {
		source: "board",
		text: text.filter((part) => part !== "").join(" "),
		data: stepOf(youOf(game), board, reply === undefined ? [ours] : [ours, reply]),
	};
}

/** Play one of the legal moves; there are none once the game is over, which ends the case. */
export const move = action<ChessGame, Play>({
	name: "move",
	options(state) {
		const before = movesOf(state.log);
		const board = replay(state.workspace.start, before);
		if (statusOf(board) !== "playing") return [];
		return board.moves({ verbose: true }).map((legal) => ({
			key: `${String(before.length)}:${legal.lan}`,
			text: describe(legal),
			arg: { before, lan: legal.lan },
			data: { from: legal.from, to: legal.to, san: legal.san },
		}));
	},
	observe: play,
});

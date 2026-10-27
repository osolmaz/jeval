import { validateFen } from "chess.js";
import { z } from "zod";

/** The position every standard game starts from. */
export const STANDARD_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * A chess game: whom the model plays against, an opponent that picks random legal moves, the Stockfish engine, or
 * itself; the side it plays against an opponent; the seed that picks the random opponent's moves; how many milliseconds
 * Stockfish thinks about each move; and the start position in FEN, the standard one when none is given. When the start
 * position has the opponent to move, the opponent moves first.
 */
export const caseSchema = z.object({
	id: z.string().min(1),
	opponent: z.enum(["random", "stockfish", "self"]).default("random"),
	side: z.enum(["white", "black"]).default("white"),
	seed: z.number().int().default(0),
	movetime: z.number().int().positive().default(1000),
	start: z
		.string()
		.default(STANDARD_START)
		.refine((fen) => validateFen(fen).ok, { message: "not a valid FEN position" }),
});
export type ChessCase = z.infer<typeof caseSchema>;

/** A chess engine: its name, and its move in a position, in long algebraic notation such as e2e4 or a7a8q. */
export interface Engine {
	readonly name: string;
	move(fen: string): Promise<string>;
}

/** A game as the domain plays it: the case, and the engine when the opponent is one. */
export type ChessGame = ChessCase & { readonly engine?: Engine };

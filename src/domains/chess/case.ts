import { validateFen } from "chess.js";
import { z } from "zod";

/** The position every standard game starts from. */
export const STANDARD_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * A chess game: the side the model plays, the seed of the opponent that picks random legal moves, and the start
 * position in FEN, the standard one when none is given. When the start position has the opponent to move, the
 * opponent moves first.
 */
export const caseSchema = z.object({
	id: z.string().min(1),
	side: z.enum(["white", "black"]),
	seed: z.number().int(),
	start: z
		.string()
		.default(STANDARD_START)
		.refine((fen) => validateFen(fen).ok, { message: "not a valid FEN position" }),
});
export type ChessCase = z.infer<typeof caseSchema>;

import { validateFen } from "chess.js";
import { z } from "zod";

/** The position every standard game starts from. */
export const STANDARD_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * A chess game: whom the model plays against, an opponent that picks random legal moves or itself; the side it plays
 * against the random opponent, whose seed picks its moves; and the start position in FEN, the standard one when none is
 * given. When the start position has the random opponent to move, the opponent moves first.
 */
export const caseSchema = z.object({
	id: z.string().min(1),
	opponent: z.enum(["random", "self"]).default("random"),
	side: z.enum(["white", "black"]).default("white"),
	seed: z.number().int().default(0),
	start: z
		.string()
		.default(STANDARD_START)
		.refine((fen) => validateFen(fen).ok, { message: "not a valid FEN position" }),
});
export type ChessCase = z.infer<typeof caseSchema>;

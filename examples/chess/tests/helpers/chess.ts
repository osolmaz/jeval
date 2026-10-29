import { Chess } from "chess.js";
import { PICK_ID } from "@osolmaz/switch";
import { answered, type Policy } from "@osolmaz/switch/testing";
import { stateAfter } from "../../src/game.ts";
import { type ChessCase, type ChessState, caseSchema, STANDARD_START, TEXTS } from "../../src/index.ts";

export const game = (fields: Partial<ChessCase> = {}): ChessCase =>
	caseSchema.parse({ id: "g1", side: "white", seed: 7, ...fields });

/**
 * Picks the first choice whose text `wanted` matches, or the first choice, or resigning when `wanted` is "resign";
 * every choice gets a probability, the picked one the most.
 */
export function choosing(wanted: RegExp | "resign" | null = null): Policy {
	return (request) => {
		const question = request.decisionQuestions[PICK_ID];
		if (question?.type !== "choice") return answered({});
		const labels = Object.keys(question.criteria);
		const pattern = wanted === "resign" ? new RegExp(`^${TEXTS.resign}$`) : wanted;
		const hit = pattern === null ? undefined : labels.find((label) => pattern.test(question.criteria[label] ?? ""));
		const choice = hit ?? labels[0] ?? "o1";
		const rest = 0.4 / Math.max(1, labels.length - 1);
		const probabilities = Object.fromEntries(labels.map((label) => [label, label === choice ? 0.6 : rest]));
		return answered({ [PICK_ID]: { type: "choice", choice, probabilities, confidence: 0.5 } });
	};
}

/** The state after `moves` from `start`, with the model on `you` against the random opponent with seed 7. */
export function stateOf(
	moves: readonly string[],
	you: ChessState["you"] = "white",
	start = STANDARD_START,
): ChessState {
	const board = new Chess(start);
	const played = moves.map((move) => board.move(move));
	const before: ChessState = {
		you,
		opponent: "random legal moves, seed 7",
		start,
		moves: [],
		san: [],
		fen: start,
		status: "playing",
		check: false,
		last: "",
	};
	return stateAfter(before, board, played, "");
}

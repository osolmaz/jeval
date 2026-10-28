import { Chess } from "chess.js";
import type { Policy } from "@osolmaz/switch/testing";
import { stateAfter } from "../../src/game.ts";
import { type ChessCase, type ChessState, caseSchema, STANDARD_START } from "../../src/index.ts";

const USAGE = { inputTokens: 10, milliseconds: 1 } as const;

export const game = (fields: Partial<ChessCase> = {}): ChessCase =>
	caseSchema.parse({ id: "g1", side: "white", seed: 7, ...fields });

/**
 * Picks the first choice whose text `wanted` matches, or the first choice, or stop when `wanted` is "stop"; every
 * choice gets a probability, the picked one the most.
 */
export function picking(wanted: RegExp | "stop" | null = null): Policy {
	return (request) => {
		const question = request.questions[0];
		if (question?.type !== "choice") return { ok: true, answers: {}, usage: USAGE };
		const labels = Object.keys(question.choices);
		const hit =
			wanted instanceof RegExp ? labels.find((label) => wanted.test(question.choices[label] ?? "")) : undefined;
		const choice = wanted === "stop" ? "stop" : (hit ?? labels[0] ?? "stop");
		const rest = 0.4 / Math.max(1, labels.length - 1);
		const probabilities = Object.fromEntries(labels.map((label) => [label, label === choice ? 0.6 : rest]));
		return { ok: true, answers: { [question.id]: { type: "choice", choice, probabilities } }, usage: USAGE };
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

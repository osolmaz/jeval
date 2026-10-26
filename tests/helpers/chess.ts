import { Chess } from "chess.js";
import type { Entry } from "../../src/core/index.ts";
import { type ChessCase, caseSchema } from "../../src/domains/chess/index.ts";
import { stepOf } from "../../src/domains/chess/game.ts";
import type { Policy } from "./fakes.ts";

const USAGE = { inputTokens: 10, milliseconds: 1 } as const;

export const game = (fields: Partial<ChessCase> = {}): ChessCase =>
	caseSchema.parse({ id: "g1", side: "white", seed: 7, ...fields });

/**
 * Picks the first option whose text `wanted` matches, or the first option, or stop when `wanted` is "stop"; every
 * option gets a probability, the picked one the most.
 */
export function picking(wanted: RegExp | "stop" | null = null): Policy {
	return (request) => {
		const question = request.questions[0];
		if (question?.kind !== "choice") return { ok: true, answers: {}, usage: USAGE };
		const labels = Object.keys(question.choices);
		const hit =
			wanted instanceof RegExp ? labels.find((label) => wanted.test(question.choices[label] ?? "")) : undefined;
		const choice = wanted === "stop" ? "stop" : (hit ?? labels[0] ?? "stop");
		const rest = 0.4 / Math.max(1, labels.length - 1);
		const probabilities = Object.fromEntries(labels.map((label) => [label, label === choice ? 0.6 : rest]));
		return { ok: true, answers: { [question.id]: { kind: "choice", choice, probabilities } }, usage: USAGE };
	};
}

/** A log of one step that played `moves` from the standard start, as the model on `side`. */
export function logOf(side: ChessCase["side"], moves: readonly string[]): Entry[] {
	const board = new Chess();
	const played = moves.map((move) => board.move(move));
	return [
		{ action: "start", key: "start", observation: { source: "board", text: "", data: stepOf(side, board, played) } },
	];
}

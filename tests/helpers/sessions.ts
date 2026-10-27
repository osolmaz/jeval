import { run, STOP_KEY } from "../../src/core/index.ts";
import { chess, type ChessCase, LIMITS, outcomeOf } from "../../src/domains/chess/index.ts";
import { storyOf } from "../../src/view/frames.ts";
import type { Session } from "../../src/view/web/model.ts";
import { game, picking } from "./chess.ts";
import { answering, factsDomain, fakeDecider, type Policy } from "./fakes.ts";

/** A chess game played by `policy` for at most `steps` moves, as the viewer receives it. */
export async function chessSession(
	options: Partial<Pick<ChessCase, "side" | "opponent" | "start">> & {
		steps?: number;
		policy?: Policy;
		finished?: boolean;
	} = {},
): Promise<Session> {
	const { steps = 3, policy = picking(), finished = true, ...fields } = options;
	const world = game(fields);
	const result = await run(chess, world, fakeDecider(policy), { case: "g1", limits: { ...LIMITS, steps } });
	return {
		story: storyOf(result.trace.entries),
		outcome: finished ? outcomeOf(world, result.history, false) : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

/**
 * A case of the test domain, which has no part of the page: the model looks up `steps` facts, then stops, and answers
 * every fact's question. As the viewer receives it.
 */
export async function factsSession(options: { steps?: number; finished?: boolean } = {}): Promise<Session> {
	const { steps = 2, finished = true } = options;
	let calls = 0;
	const decider = fakeDecider(answering(0.7, (labels) => (calls++ < steps ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
	const facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };
	const result = await run(factsDomain, facts, decider, { case: "f1" });
	return {
		story: storyOf(result.trace.entries),
		outcome: finished ? { result: "answered", reason: "the model stopped", looked: steps } : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

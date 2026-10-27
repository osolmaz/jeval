import { run } from "../../src/core/index.ts";
import { chess, type ChessCase, LIMITS, outcomeOf } from "../../src/domains/chess/index.ts";
import { storyOf } from "../../src/view/frames.ts";
import type { Session } from "../../src/view/web/model.ts";
import { game, picking } from "./chess.ts";
import { fakeDecider, type Policy } from "./fakes.ts";

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

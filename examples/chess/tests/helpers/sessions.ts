import { run } from "@osolmaz/switch";
import type { Session } from "@osolmaz/switch/page";
import { fakeDecider, type Policy } from "@osolmaz/switch/testing";
import { storyOf } from "@osolmaz/switch/viewer";
import { CHESS, type ChessCase, chessMachine, LIMITS, outcomeOf } from "../../src/index.ts";
import { game, picking } from "./chess.ts";

/** A chess game played by `policy` for at most `steps` moves, as the viewer receives it. */
export async function chessSession(
	options: Partial<Pick<ChessCase, "side" | "opponent" | "start">> & {
		steps?: number;
		policy?: Policy;
		finished?: boolean;
	} = {},
): Promise<Session> {
	const { steps = 3, policy = picking(), finished = true, ...fields } = options;
	const result = await run(CHESS, chessMachine(game(fields)), fakeDecider(policy), { limits: { ...LIMITS, steps } });
	return {
		story: storyOf(result.trace.entries, "g1"),
		outcome: finished ? outcomeOf(result.state, false) : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

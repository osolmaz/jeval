import { run } from "../../src/core/index.ts";
import { chess, LIMITS, outcomeOf } from "../../src/domains/chess/index.ts";
import { storyOf } from "../../src/view/frames.ts";
import type { Session } from "../../src/view/web/model.ts";
import { game, picking } from "./chess.ts";
import { fakeDecider, type Policy } from "./fakes.ts";

/** A chess game played by `policy` for at most `steps` moves, as the viewer receives it. */
export async function chessSession(
	options: { side?: "white" | "black"; steps?: number; policy?: Policy; finished?: boolean; start?: string } = {},
): Promise<Session> {
	const workspace = game({
		side: options.side ?? "white",
		...(options.start === undefined ? {} : { start: options.start }),
	});
	const result = await run(chess, workspace, fakeDecider(options.policy ?? picking()), {
		case: "g1",
		limits: { ...LIMITS, steps: options.steps ?? 3 },
	});
	const finished = options.finished ?? true;
	return {
		story: storyOf(result.trace.entries),
		outcome: finished ? outcomeOf(workspace, result.log, false) : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

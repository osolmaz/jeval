import { run } from "@osolmaz/switch";
import { fakeDecider, type Policy } from "@osolmaz/switch/testing";
import { storyOf } from "@osolmaz/switch-viewer";
import type { Session } from "@osolmaz/switch-viewer/page";
import { CHESS, type ChessCase, chessMachine, LIMITS, outcomeOf } from "../../src/index.ts";
import { chessViewer } from "../../src/viewer.ts";
import { game, picking } from "./chess.ts";

/** The chess viewer's summary of an outcome, as the server puts it in a session. */
const summaryOf = (outcome: Readonly<Record<string, unknown>> | null): string | null =>
	outcome === null ? null : (chessViewer.summary?.(outcome) ?? null);

/** A chess game played by `policy` for at most `steps` moves, as the viewer receives it. */
export async function chessSession(
	options: Partial<Pick<ChessCase, "side" | "opponent" | "start">> & {
		steps?: number;
		policy?: Policy;
		finished?: boolean;
	} = {},
): Promise<Session> {
	const { steps = 3, policy = picking(), finished = true, ...fields } = options;
	const result = await run(
		{ ...CHESS, limits: { ...LIMITS, steps } },
		chessMachine(game(fields)),
		fakeDecider(policy),
	);
	const outcome = finished ? outcomeOf(result) : null;
	return {
		story: storyOf(result.trace.entries, "g1"),
		outcome,
		summary: summaryOf(outcome),
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

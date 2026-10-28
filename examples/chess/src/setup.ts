import { type Runner, runnerOf } from "@osolmaz/switch";
import { CHESS, chessMachine, outcomeOf } from "./index.ts";
import { loadCase, loadGame } from "./load.ts";

/**
 * The chess domain. It has no flags of its own, and its definition is switch's default: its two texts and its limits.
 * A game's outcome counts the stop choice as a resignation.
 */
export function chessSetup(): Promise<Runner> {
	return Promise.resolve(
		runnerOf({
			...CHESS,
			caseId: async (folder) => (await loadCase(folder)).id,
			load: async (folder) => chessMachine(await loadGame(folder)),
			outcome: (state, result) => outcomeOf(state, result.ended),
		}),
	);
}

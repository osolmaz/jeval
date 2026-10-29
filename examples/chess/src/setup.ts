import { type Runner, runnerOf } from "@osolmaz/switch";
import { CHESS, chessMachine, outcomeOf } from "./index.ts";
import { loadCase, loadGame } from "./load.ts";

/**
 * The chess domain. It has no flags of its own, and its definition is the pick's texts and the limits. A game's
 * outcome says who won and why.
 */
export function chessSetup(): Promise<Runner> {
	return Promise.resolve(
		runnerOf({
			...CHESS,
			caseId: async (folder) => (await loadCase(folder)).id,
			load: async (folder) => chessMachine(await loadGame(folder)),
			outcome: outcomeOf,
		}),
	);
}

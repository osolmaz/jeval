import { definitionOf, type Runner, runnerOf } from "@osolmaz/switch";
import { CHESS, chessMachine, outcomeOf } from "./index.ts";
import { loadCase, loadGame } from "./load.ts";

/**
 * The chess domain. It has no flags of its own: its definition is its two texts and its limits. A game's outcome
 * counts the stop choice as a resignation.
 */
export function chessSetup(): Promise<Runner> {
	return Promise.resolve(
		runnerOf({
			...CHESS,
			definition: definitionOf(CHESS.name, {
				stop: CHESS.stop,
				instructions: CHESS.instructions,
				limits: { ...CHESS.limits },
			}),
			caseId: async (folder) => (await loadCase(folder)).id,
			load: async (folder) => chessMachine(await loadGame(folder)),
			outcome: (state, result) => outcomeOf(state, result.ended === "stop"),
		}),
	);
}

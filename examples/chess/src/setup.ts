import { DefinitionError, definitionOf, type Runner, runnerOf } from "@osolmaz/switch";
import { CHESS, chessMachine, outcomeOf } from "./index.ts";
import { loadCase, loadGame } from "./load.ts";

/**
 * The chess domain. It takes no definition file: its definition is its two texts and its limits. A game's outcome
 * counts the stop choice as a resignation.
 */
export function chessSetup(file: string | undefined): Promise<Runner> {
	if (file !== undefined) return Promise.reject(new DefinitionError("the chess domain takes no definition file"));
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

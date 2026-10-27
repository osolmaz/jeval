import { definitionOf, type Runner, runnerOf, SetupError } from "../../core/index.ts";
import { chess, LIMITS, outcomeOf } from "./index.ts";
import { loadCase, loadGame } from "./load.ts";

/**
 * The chess domain. It takes no definition file: its definition is its two texts and its limits. A game's outcome
 * counts the stop choice as a resignation.
 */
export function chessSetup(file: string | undefined): Promise<Runner> {
	if (file !== undefined) return Promise.reject(new SetupError("the chess domain takes no definition file"));
	return Promise.resolve(
		runnerOf({
			domain: chess,
			definition: definitionOf(chess.name, {
				stop: chess.stop,
				instructions: chess.instructions,
				limits: { ...LIMITS },
			}),
			limits: LIMITS,
			caseId: async (folder) => (await loadCase(folder)).id,
			load: (folder) => loadGame(folder),
			outcome: (game, result) => outcomeOf(game, result.history, result.ended === "stop"),
		}),
	);
}

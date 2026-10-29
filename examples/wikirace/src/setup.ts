import { type Runner, runnerOf } from "@osolmaz/switch";
import { loadRace } from "./case.ts";
import { openRace, outcomeOf, raceMachine, WIKIRACE } from "./race.ts";
import { type Wiki, wikipedia } from "./wiki.ts";

/**
 * The wikirace domain, which reads Wikipedia through `wiki`. It has no flags of its own, and its definition is the
 * pick's texts and the limits.
 */
export function wikiraceSetup(wiki: Wiki = wikipedia()): Promise<Runner> {
	return Promise.resolve(
		runnerOf({
			...WIKIRACE,
			caseId: async (folder) => (await loadRace(folder)).id,
			load: async (folder) => raceMachine(await openRace(await loadRace(folder), wiki), wiki),
			outcome: outcomeOf,
		}),
	);
}

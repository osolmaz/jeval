import { type Domain, joinMenus } from "@osolmaz/switch";
import { changes } from "./choices/changes.ts";
import { compare } from "./choices/compare.ts";
import { count } from "./choices/count.ts";
import { look } from "./choices/look.ts";
import { read } from "./choices/read.ts";
import { search } from "./choices/search.ts";
import { itemVerdict, type Judge } from "./definition.ts";
import { judgeWith } from "./judge.ts";
import { openAnswer } from "./start.ts";
import { view } from "./view.ts";
import type { World } from "./world.ts";

/** The version of this domain's code; the judge definition's name and hash follow it in a run's version. */
export const CODE_VERSION = "0.3.0";

/**
 * Grades a saved answer to a legal task against its rubric with a judge definition: the model gathers evidence by
 * choosing from the menu, then answers the judge's questions about every rubric item, and each item gets one verdict.
 */
export function legalJudge({ definition, hash }: Judge): Domain<World> {
	return {
		name: "legal-judge",
		version: `${CODE_VERSION} ${definition.name}@${hash.slice(0, 12)}`,
		menu: joinMenus(read, look, search, count, changes, compare),
		stop: definition.texts.stop,
		instructions: `${definition.texts.gather} ${definition.texts.choose}`,
		questions: (world) => world.case.items.map(itemVerdict),
		start: openAnswer,
		view: (world, history, purpose, tokens) => view(definition.texts, world, history, purpose, tokens),
		answer: judgeWith(definition),
	};
}

export { type LegalCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export { makeWorld, type World } from "./world.ts";

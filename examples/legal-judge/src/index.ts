import { type BoundChoice, type DomainShared, joinTypes, type StateMachine } from "@osolmaz/switch";
import { changes } from "./choices/changes.ts";
import { compare } from "./choices/compare.ts";
import { count } from "./choices/count.ts";
import { look } from "./choices/look.ts";
import { read } from "./choices/read.ts";
import { search } from "./choices/search.ts";
import { itemVerdict, type Judge, type JudgeDefinition } from "./definition.ts";
import { judgeWith } from "./judge.ts";
import { openAnswer } from "./start.ts";
import type { CaseFolder, LegalState } from "./state.ts";
import { searchTerms } from "./terms.ts";
import { view } from "./view.ts";

/** The version of this domain's code. A run records the judge apart, as its definition with its hash. */
export const CODE_VERSION = "0.5.0";

/**
 * What every case shares under a judge: the domain's name and version, the two texts of the pick question, and the
 * judge's limits.
 */
export function legalJudge({ definition }: Judge): DomainShared {
	return {
		name: "legal-judge",
		version: CODE_VERSION,
		stop: definition.texts.stop,
		instructions: `${definition.texts.gather} ${definition.texts.choose}`,
		limits: definition.limits,
	};
}

/**
 * The state machine of one case: the model gathers evidence by picking from the choices, then answers the judge's
 * questions about every rubric item, and each item gets one verdict.
 */
export function legalMachine(
	definition: JudgeDefinition,
	folder: CaseFolder,
): StateMachine<LegalState, BoundChoice<LegalState>> {
	const legalCase = folder.case;
	return {
		initial: () => Promise.resolve(openAnswer(legalCase)),
		...joinTypes(
			read(legalCase),
			look(legalCase),
			search(legalCase, searchTerms(legalCase)),
			count(legalCase),
			changes(legalCase),
			compare(legalCase),
		),
		view: (state, purpose, tokens, charsPerToken) =>
			view(definition.texts, folder, state, purpose, tokens, charsPerToken),
		questions: () => Object.fromEntries(legalCase.items.map((item) => [item.id, itemVerdict(item)])),
		answer: judgeWith(definition, folder),
	};
}

export { type LegalCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export type { CaseFolder, Evidence, LegalState } from "./state.ts";

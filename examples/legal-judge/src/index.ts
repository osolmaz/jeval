import { type BoundChoice, type DomainTexts, joinTypes, type StateMachine } from "@osolmaz/switch";
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

/** The version of this domain's code; the judge definition's name and hash follow it in a run's version. */
export const CODE_VERSION = "0.4.0";

/** What every case shares under a judge: the domain's name and version, and the two texts of the pick question. */
export function legalJudge({ definition, hash }: Judge): DomainTexts {
	return {
		name: "legal-judge",
		version: `${CODE_VERSION} ${definition.name}@${hash.slice(0, 12)}`,
		stop: definition.texts.stop,
		instructions: `${definition.texts.gather} ${definition.texts.choose}`,
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
		view: (state, purpose, tokens) => view(definition.texts, folder, state, purpose, tokens),
		questions: () => legalCase.items.map(itemVerdict),
		answer: judgeWith(definition, legalCase),
	};
}

export { type LegalCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export type { CaseFolder, Evidence, LegalState } from "./state.ts";

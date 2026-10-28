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
import type { CaseFolder, JudgeState } from "./state.ts";
import { searchTerms } from "./terms.ts";
import { view } from "./view.ts";

/** The version of this domain's code. A run records the judge apart, as its definition with its hash. */
export const CODE_VERSION = "0.5.0";

/**
 * What every case shares under a judge: the domain's name and version, the two texts of the pick question, and the
 * judge's limits.
 */
export function rubricJudge({ definition }: Judge): DomainShared {
	return {
		name: "rubric-judge",
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
export function judgeMachine(
	definition: JudgeDefinition,
	folder: CaseFolder,
): StateMachine<JudgeState, BoundChoice<JudgeState>> {
	const judgeCase = folder.case;
	return {
		initial: () => Promise.resolve(openAnswer(judgeCase)),
		...joinTypes(
			read(judgeCase),
			look(judgeCase),
			search(judgeCase, searchTerms(judgeCase)),
			count(judgeCase),
			changes(judgeCase),
			compare(judgeCase),
		),
		view: (state, purpose, tokens, charsPerToken) =>
			view(definition.texts, folder, state, purpose, tokens, charsPerToken),
		questions: () => Object.fromEntries(judgeCase.items.map((item) => [item.id, itemVerdict(item)])),
		answer: judgeWith(definition, folder),
	};
}

export { type JudgeCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export type { CaseFolder, Evidence, JudgeState } from "./state.ts";

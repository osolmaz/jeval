import type { Domain } from "../../core/index.ts";
import { changes } from "./actions/changes.ts";
import { compare } from "./actions/compare.ts";
import { count } from "./actions/count.ts";
import { look } from "./actions/look.ts";
import { read } from "./actions/read.ts";
import { search } from "./actions/search.ts";
import { itemVerdict, type Judge } from "./definition.ts";
import { judgeWith } from "./judge.ts";
import { openAnswer } from "./start.ts";
import { view } from "./view.ts";
import type { Workspace } from "./workspace.ts";

/** The version of this domain's code; the judge definition's name and hash follow it in a run's version. */
export const CODE_VERSION = "0.3.0";

/**
 * Grades a saved answer to a legal task against its rubric with a judge definition: the model gathers evidence by
 * choosing steps, then answers the judge's questions about every rubric item, and each item gets one verdict.
 */
export function legalJudge({ definition, hash }: Judge): Domain<Workspace> {
	return {
		name: "legal-judge",
		version: `${CODE_VERSION} ${definition.name}@${hash.slice(0, 12)}`,
		actions: [read, look, search, count, changes, compare],
		stop: definition.texts.stop,
		choose: `${definition.texts.gather} ${definition.texts.choose}`,
		questions: (workspace) => workspace.case.items.map(itemVerdict),
		start: openAnswer,
		view: (state, purpose, tokens) => view(definition.texts, state, purpose, tokens),
		judge: judgeWith(definition),
	};
}

export { type LegalCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export { makeWorkspace, type Workspace } from "./workspace.ts";

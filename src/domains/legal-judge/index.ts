import type { Domain } from "../../core/index.ts";
import { changes } from "./actions/changes.ts";
import { compare } from "./actions/compare.ts";
import { count } from "./actions/count.ts";
import { look } from "./actions/look.ts";
import { read } from "./actions/read.ts";
import { search } from "./actions/search.ts";
import { stagedJudge } from "./judge.ts";
import { GATHER, itemQuestion, STOP } from "./prompts.ts";
import { SplitCache } from "./split.ts";
import { openAnswer } from "./start.ts";
import { view } from "./view.ts";
import type { Workspace } from "./workspace.ts";

/**
 * Grades a saved answer to a legal task against its rubric. Jev gathers evidence by choosing steps, then the staged
 * judge splits each rubric item into parts, checks the item, anything missed and each part, and decides each item.
 * One domain keeps one split cache, so items shared by several answers are split once.
 */
export function createLegalJudge(): Domain<Workspace> {
	return {
		name: "legal-judge",
		version: "0.2.0",
		actions: [read, look, search, count, changes, compare],
		stop: STOP,
		choose: `${GATHER} Which step should come next?`,
		questions: (workspace) => workspace.case.items.map(itemQuestion),
		start: openAnswer,
		view,
		judge: stagedJudge(new SplitCache()),
	};
}

export { type LegalCase, caseSchema } from "./case.ts";
export { itemQuestion } from "./prompts.ts";
export { makeWorkspace, type Workspace } from "./workspace.ts";

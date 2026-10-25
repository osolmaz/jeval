import type { BoolQuestion, Domain } from "../../core/index.ts";
import { changes } from "./actions/changes.ts";
import { compare } from "./actions/compare.ts";
import { count } from "./actions/count.ts";
import { look } from "./actions/look.ts";
import { read } from "./actions/read.ts";
import { search } from "./actions/search.ts";
import type { Item } from "./case.ts";
import { openAnswer } from "./start.ts";
import { GOAL, view } from "./view.ts";
import type { Workspace } from "./workspace.ts";

export const FRAME =
	"You are grading an AI assistant's answer to a legal task against one rubric item. The state holds the request the " +
	"assistant received (`request`) and `evidence`: the files the assistant submitted (paths under output/), and passages, " +
	"searches, counts and comparisons taken from them and from the task's documents. Apply the item's PASS rule and any " +
	"FAIL rules exactly as written; equivalent wording passes, and anything the submitted files do not state does not " +
	"count. Use the task's documents to check facts, figures and citations in the answer.\n\n";

export function itemQuestion(item: Item): BoolQuestion {
	const category = item.category === null ? "" : ` (${item.category})`;
	return {
		kind: "bool",
		id: item.id,
		instructions: `${FRAME}Rubric item ${item.id}${category}:\n${item.text}`,
		yes: "The submitted answer meets this rubric item.",
		no: "The submitted answer does not meet this rubric item.",
	};
}

/** Grades a saved answer to a legal task against its rubric, one yes-or-no question per rubric item. */
export const legalJudge: Domain<Workspace> = {
	name: "legal-judge",
	version: "0.1.0",
	actions: [read, look, search, count, changes, compare],
	stop: "Stop gathering evidence: the state is enough to grade every rubric item",
	choose: `${GOAL} Pick the step that best gathers evidence still needed to decide the rubric items, or stop when nothing important is missing.`,
	questions: (workspace) => workspace.case.items.map(itemQuestion),
	start: openAnswer,
	view,
};

export { type LegalCase, caseSchema } from "./case.ts";
export { makeWorkspace, type Workspace } from "./workspace.ts";

import type { BoolQuestion } from "../../core/index.ts";
import type { Item } from "./case.ts";

/**
 * Every text Jev reads in the legal-judge domain. Each request carries the description of the whole process and of its
 * stage in its state, so the model knows what it is doing and what its answer is used for; each question then states
 * only what is specific to it.
 */

export const PROCESS =
	"An automated grader is checking an AI assistant's answer to a legal task against the task's rubric. It works in " +
	"two stages. 1. Gather evidence: it reads the answer's files and, where needed, parts of the task's documents. " +
	"2. Check: for each rubric item it asks whether the answer meets the item, and whether the answer misses or " +
	"contradicts any of the item's requirements; an item passes only when the answer meets it and misses nothing. You " +
	"answer the questions of one stage at a time.";

export const GATHER =
	"Stage 1, gathering evidence. `evidence` holds what has been read so far; the answer's files are already there. " +
	"Each step adds one thing: part of a file, a page image, the passages that mention a term, a word count, the " +
	"tracked changes of a Word file, or a comparison of an edited Word file with its original. Pick the step that best " +
	"adds what is still missing to decide the rubric items, such as the passage of a task document that an item's facts, " +
	"figures or citations depend on. Pick stop when the evidence is enough to decide every item.";

export const STOP = "Stop gathering evidence: the evidence is enough to decide every rubric item";

export const CHECK =
	"Stage 2, checking. `request` is what the assistant was asked, and `evidence` holds the files it submitted (paths " +
	"under output/) and what was read from the task's documents. Judge only from the evidence. Each item gets two " +
	"questions: whether the answer meets it, and whether the answer misses or contradicts any of its requirements.";

export const RULES =
	"Apply each rubric item's PASS rule and FAIL rules exactly as written; equivalent wording passes. Mentioning a topic " +
	"is not meeting a requirement about it: the answer must do or contain what the requirement asks. If the answer says " +
	"the opposite, or says the required thing does not exist (for example 'there is no extension' where the item asks " +
	"for the extension mechanism), the requirement is not met. Anything the submitted files do not state does not count. " +
	"Use the task's documents to check facts, figures and citations in the answer.";

const label = (item: Item): string => `Rubric item ${item.id}${item.category === null ? "" : ` (${item.category})`}`;

/** The domain's question per item; the judge answers it from the meets and misses questions below. */
export function itemQuestion(item: Item): BoolQuestion {
	return {
		kind: "bool",
		id: item.id,
		instructions: `${RULES}\n\n${label(item)}:\n${item.text}\n\nDoes the submitted answer meet this item?`,
		yes: "The submitted answer meets this rubric item.",
		no: "The submitted answer does not meet this rubric item.",
	};
}

export function meetsQuestion(item: Item): BoolQuestion {
	return {
		kind: "bool",
		id: `${item.id}/meets`,
		instructions: `${label(item)}:\n${item.text}\n\nDoes the submitted answer meet this item?`,
		yes: "The submitted answer meets this item.",
		no: "The submitted answer does not meet this item.",
	};
}

export function missesQuestion(item: Item): BoolQuestion {
	return {
		kind: "bool",
		id: `${item.id}/misses`,
		instructions:
			`${label(item)}:\n${item.text}\n\nCheck each requirement of this item and each FAIL rule separately. Does the ` +
			"submitted answer miss or contradict at least one of them?",
		yes: "The submitted answer misses or contradicts at least one requirement of this item.",
		no: "The submitted answer meets every requirement of this item.",
	};
}

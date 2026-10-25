import type { BoolQuestion } from "../../core/index.ts";
import type { Item } from "./case.ts";

/**
 * Every text Jev reads in the legal-judge domain. Each request carries the description of the whole process and of its
 * stage in its state, so the model knows what it is doing and what its answer is used for; each question then states
 * only what is specific to it.
 */

export const PROCESS =
	"An automated grader is checking an AI assistant's answer to a legal task against the task's rubric. It works in " +
	"five stages. 1. Gather evidence: it reads the answer's files and, where needed, parts of the task's documents. " +
	"2. Split: it breaks each rubric item into its separate requirements so that each can be checked on its own; the " +
	"item's wording is never changed, the parts are only highlighted. 3. Point: for each requirement it finds the " +
	"sentence of the answer that meets it, by choosing one level at a time (file, section, paragraph, sentence), or " +
	"finds that no sentence does. 4. Check: it judges each pointed sentence on its own, and asks whether the answer " +
	"meets the whole item and whether it misses any requirement. 5. Decide: it makes the final pass or fail decision " +
	"for each item from those checks and the evidence. You answer the questions of one stage at a time.";

export const GATHER =
	"Stage 1, gathering evidence. `evidence` holds what has been read so far; the answer's files are already there. " +
	"Each step adds one thing: part of a file, a page image, the passages that mention a term, a word count, the " +
	"tracked changes of a Word file, or a comparison of an edited Word file with its original. Pick the step that best " +
	"adds what is still missing to decide the rubric items, such as the passage of a task document that an item's facts, " +
	"figures or citations depend on. Pick stop when the evidence is enough to decide every item.";

export const STOP = "Stop gathering evidence: the evidence is enough to decide every rubric item";

export const SPLIT =
	"Stage 2, splitting. `items` holds the rubric items. A separate requirement is something the answer must do or " +
	"contain that an answer could meet while missing the others, such as a date, a party, a duty, an amount or an " +
	"exception. These are not separate requirements: examples, a detail that qualifies the same requirement (such as a " +
	"deadline or a condition), and words such as 'however phrased'. Words that several parts share, such as the object " +
	"in 'inform, support or benchmark any engagement', belong with all of them: do not split between them.";

export const NO_SPLIT = "No new requirement starts at any of these places.";

export const ACCEPT =
	"Stage 2, checking the splits. `items` holds the rubric items. Each question shows how one item was split into " +
	"numbered parts.";

export const POINT =
	"Stage 3, pointing to evidence. Each question names one requirement and shows where you are in the answer. Pick " +
	"the option that is, or contains, the sentence of the answer that meets the requirement; you then go one level " +
	"deeper, down to a single sentence. Pick the last option if nothing here meets it. Mentioning the topic is not " +
	"meeting the requirement: a sentence that says the opposite, or says that the required thing does not exist, is " +
	"not evidence for it.";

export const NO_EVIDENCE = "Nothing here meets the requirement.";
export const ELSEWHERE = "None of these sentences: look through the whole answer";

export const CHECK_POINTED =
	"Stage 4, checking each pointed sentence on its own. Each question shows one requirement and the sentence of the " +
	"answer that stage 3 pointed to, with its paragraph.";

export const RULES =
	"Apply each rubric item's PASS rule and FAIL rules exactly as written; equivalent wording passes. Mentioning a topic " +
	"is not meeting a requirement about it: the answer must do or contain what the requirement asks. If the answer says " +
	"the opposite, or says the required thing does not exist (for example 'there is no extension' where the item asks " +
	"for the extension mechanism), the requirement is not met. Anything the submitted files do not state does not count. " +
	"Use the task's documents to check facts, figures and citations in the answer.";

export const CHECK =
	"Stage 4, checking whole items. `request` is what the assistant was asked, and `evidence` holds the files it " +
	"submitted (paths under output/) and what was read from the task's documents. Judge only from the evidence.";

export const DECIDE =
	"Stage 5, deciding. Each question lists the checks of stage 4 for one item. Use them and the evidence to decide; " +
	"when the checks disagree, settle it from the evidence.";

const label = (item: Item): string => `Rubric item ${item.id}${item.category === null ? "" : ` (${item.category})`}`;

/** Asked when a domain run has no staged judge; the staged judge answers the same ids in stage 5. */
export function itemQuestion(item: Item): BoolQuestion {
	return {
		kind: "bool",
		id: item.id,
		instructions: `${RULES}\n\n${label(item)}:\n${item.text}\n\nDoes the submitted answer meet this item?`,
		yes: "The submitted answer meets this rubric item.",
		no: "The submitted answer does not meet this rubric item.",
	};
}

/** The question of the split search: the core shows the item's word gaps as options. */
export const splitQuestion = (item: Item): string =>
	`${label(item)}: ${item.text}\n\nAt which of these places does a new, separate requirement of this item start?`;

export function acceptQuestion(item: Item, parts: readonly string[]): BoolQuestion {
	const numbered = parts.map((part, index) => `[${String(index + 1)}] ${part}`).join("\n");
	return {
		kind: "bool",
		id: `${item.id}/accept`,
		instructions:
			`${label(item)} was split into these parts:\n${numbered}\n\nIs this split correct? Each part must be one whole ` +
			"requirement, no requirement or shared phrase may be cut in two, and together the parts must cover the whole item.",
		yes: "The split is correct.",
		no: "The split is wrong.",
	};
}

/** The question of an evidence search for one requirement: a part of an item, or a whole item. */
export const evidenceQuestion = (item: Item, highlighted: string | null): string =>
	highlighted === null
		? `${label(item)}: ${item.text}\n\nWhere is the sentence of the answer that meets this item?`
		: `${label(item)}, with one part between ⟦ and ⟧: ${highlighted}\n\nWhere is the sentence of the answer that meets the highlighted part?`;

/** A requirement and the sentence of the answer pointed to as its evidence. */
export interface Pointed {
	readonly id: string;
	readonly item: Item;
	readonly highlighted: string | null;
	readonly sentence: string;
	readonly paragraph: string;
	readonly where: string;
}

export function pointedQuestion(pointed: Pointed): BoolQuestion {
	const requirement =
		pointed.highlighted === null
			? `${label(pointed.item)}: ${pointed.item.text}`
			: `${label(pointed.item)}, with one part between ⟦ and ⟧: ${pointed.highlighted}`;
	const target = pointed.highlighted === null ? "this item" : "the highlighted part";
	return {
		kind: "bool",
		id: pointed.id,
		instructions:
			`${requirement}\n\nThe sentence of the answer pointed to as the evidence (${pointed.where}):\n«${pointed.sentence}»\n` +
			`Its paragraph: «${pointed.paragraph}»\n\nDoes this sentence, as written, meet ${target}? If it says the ` +
			"opposite, or says that the required thing does not exist, it does not.",
		yes: `The sentence meets ${target}.`,
		no: `The sentence does not meet ${target}.`,
	};
}

export function meetsQuestion(item: Item): BoolQuestion {
	return {
		kind: "bool",
		id: `${item.id}/meets`,
		instructions: `${label(item)}:\n${item.text}\n\nDoes the submitted answer meet this whole item?`,
		yes: "The submitted answer meets the whole item.",
		no: "The submitted answer does not meet the whole item.",
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

export function finalQuestion(item: Item, checks: readonly string[]): BoolQuestion {
	return {
		kind: "bool",
		id: item.id,
		instructions:
			`${label(item)}:\n${item.text}\n\nChecks from stage 4:\n${checks.join("\n")}\n\nDoes the submitted answer meet this ` +
			"item? Every requirement must be met unless the item itself says otherwise.",
		yes: "The submitted answer meets this rubric item.",
		no: "The submitted answer does not meet this rubric item.",
	};
}

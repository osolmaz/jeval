import type { Answer, Ask, BoolQuestion, JudgeContext } from "../../core/index.ts";
import type { Item } from "./case.ts";
import {
	CHECK,
	DECIDE,
	finalQuestion,
	meetsQuestion,
	missesQuestion,
	partQuestion,
	PROCESS,
	RULES,
} from "./prompts.ts";
import { highlight, partsOf, probabilityOf, type Split, type SplitCache, splitItems } from "./split.ts";
import type { Workspace } from "./workspace.ts";

/** A split is used only when Jev accepted it. */
const ACCEPT_AT = 0.5;

const usable = (split: Split | undefined): split is Split =>
	split !== undefined && split.cuts.length > 0 && (split.accepted ?? 0) >= ACCEPT_AT;

/** Stage 3's questions for one item: the whole item, anything missed, and each part of an accepted split. */
export function checkQuestions(item: Item, split: Split | undefined): BoolQuestion[] {
	const questions = [meetsQuestion(item), missesQuestion(item)];
	if (usable(split)) {
		const count = split.cuts.length + 1;
		for (let index = 0; index < count; index += 1)
			questions.push(partQuestion(item, highlight(split, index), index, count));
	}
	return questions;
}

const percent = (answer: Answer | undefined): string => `${(probabilityOf(answer) * 100).toFixed(0)}%`;

/** Stage 3's results for one item, as lines for the stage 4 question. */
export function checkLines(item: Item, split: Split | undefined, found: Readonly<Record<string, Answer>>): string[] {
	const lines = [
		`- Meets the whole item: ${percent(found[`${item.id}/meets`])} likely.`,
		`- Misses or contradicts a requirement: ${percent(found[`${item.id}/misses`])} likely.`,
	];
	if (usable(split)) {
		partsOf(split).forEach((part, index) => {
			lines.push(
				`- Meets part ${String(index + 1)} "${part}": ${percent(found[`${item.id}/part${String(index + 1)}`])} likely.`,
			);
		});
	}
	return lines;
}

/**
 * The staged judge: split each item (once per item text), check the whole item, anything missed and each part over
 * the evidence, then decide each item with the checks in view.
 */
export function stagedJudge(cache: SplitCache) {
	return async ({ state, ask }: JudgeContext<Workspace>): Promise<Readonly<Record<string, Answer>>> => {
		const items = state.workspace.case.items;
		const splits = await splitItems(items, ask, cache);
		const found = await ask(
			items.flatMap((item) => checkQuestions(item, splits.get(item.id))),
			{ stage: "check", extra: { process: PROCESS, stage: CHECK, rules: RULES } },
		);
		const finals = items.map((item) => finalQuestion(item, checkLines(item, splits.get(item.id), found)));
		return decide(finals, ask);
	};
}

const decide = (questions: readonly BoolQuestion[], ask: Ask) =>
	ask(questions, { stage: "decide", extra: { process: PROCESS, stage: DECIDE, rules: RULES } });

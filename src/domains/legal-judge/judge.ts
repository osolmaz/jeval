import { type Answer, type Ask, type JudgeContext, locate, type Node, type Pointer } from "../../core/index.ts";
import type { Item } from "./case.ts";
import { candidatesFor, type Outline, outlineOf, shorten } from "./outline.ts";
import {
	CHECK,
	CHECK_POINTED,
	DECIDE,
	ELSEWHERE,
	evidenceQuestion,
	finalQuestion,
	meetsQuestion,
	missesQuestion,
	NO_EVIDENCE,
	POINT,
	type Pointed,
	pointedQuestion,
	PROCESS,
	RULES,
} from "./prompts.ts";
import { highlight, partsOf, probabilityOf, type Split, type SplitCache, splitItems } from "./split.ts";
import type { Workspace } from "./workspace.ts";

/** A split is used only when Jev accepted it. */
const ACCEPT_AT = 0.5;

/** One requirement to find evidence for: a part of an accepted split, or the whole item. */
export interface Requirement {
	readonly id: string;
	readonly item: Item;
	/** The item with this part highlighted; null for a whole item. */
	readonly highlighted: string | null;
	/** The words to search the answer for. */
	readonly text: string;
}

export function requirementsOf(item: Item, split: Split | undefined): Requirement[] {
	if (split === undefined || split.cuts.length === 0 || (split.accepted ?? 0) < ACCEPT_AT) {
		return [{ id: `${item.id}/whole`, item, highlighted: null, text: item.text }];
	}
	return partsOf(split).map((part, index) => ({
		id: `${item.id}/part${String(index + 1)}`,
		item,
		highlighted: highlight(split, index),
		text: part,
	}));
}

/** Stage 3: one search per requirement, all run together level by level, starting from the search shortcut. */
function point(requirements: readonly Requirement[], outline: Outline, ask: Ask): Promise<Map<string, Pointer | null>> {
	const targets = requirements.map((requirement) => ({
		id: requirement.id,
		root: outline.root,
		question: evidenceQuestion(requirement.item, requirement.highlighted),
		candidates: candidatesFor(outline, requirement.text),
	}));
	return locate(ask, targets, {
		stage: "point",
		state: { process: PROCESS, stage: POINT },
		none: NO_EVIDENCE,
		elsewhere: ELSEWHERE,
	});
}

/** The check of the sentence a search ended on, with where it is in the answer. */
function pointedAt(requirement: Requirement, leaf: Node, outline: Outline): Pointed {
	const sentence = outline.sentences.get(leaf.id);
	return {
		id: `${requirement.id}/sentence`,
		item: requirement.item,
		highlighted: requirement.highlighted,
		sentence: sentence?.text ?? leaf.title,
		paragraph: shorten(sentence?.paragraph ?? leaf.title, 150),
		where: sentence === undefined ? "the answer" : `${sentence.file}, ${sentence.section}`,
	};
}

/** The sentence each search ended on, as a check question; a search that found nothing asks nothing. */
export function pointedOf(
	requirements: readonly Requirement[],
	pointers: ReadonlyMap<string, Pointer | null>,
	outline: Outline,
): Pointed[] {
	return requirements.flatMap((requirement) => {
		const leaf = pointers.get(requirement.id)?.path.at(-1);
		return leaf === undefined ? [] : [pointedAt(requirement, leaf, outline)];
	});
}

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

/** Stage 4's results for one item, as lines for the stage 5 question. */
export function checkLines(
	item: Item,
	requirements: readonly Requirement[],
	pointed: readonly Pointed[],
	found: Readonly<Record<string, Answer>>,
): string[] {
	const lines = [
		`- Meets the whole item: ${percent(probabilityOf(found[`${item.id}/meets`]))} likely.`,
		`- Misses or contradicts a requirement: ${percent(probabilityOf(found[`${item.id}/misses`]))} likely.`,
	];
	for (const requirement of requirements.filter((candidate) => candidate.item.id === item.id)) {
		const name = requirement.highlighted === null ? "The item" : `Part "${requirement.text}"`;
		const evidence = pointed.find((entry) => entry.id === `${requirement.id}/sentence`);
		lines.push(
			evidence === undefined
				? `- ${name}: no sentence of the answer was found that meets it.`
				: `- ${name}: the answer's sentence «${shorten(evidence.sentence, 60)}» meets it: ${percent(probabilityOf(found[evidence.id]))} likely.`,
		);
	}
	return lines;
}

/**
 * The staged judge: split each item (once per item text), point to the answer's evidence for each requirement, check
 * each pointed sentence and each whole item, then decide each item with all the checks in view.
 */
export function stagedJudge(cache: SplitCache) {
	return async ({ state, ask }: JudgeContext<Workspace>): Promise<Readonly<Record<string, Answer>>> => {
		const items = state.workspace.case.items;
		const splits = await splitItems(items, ask, cache);
		const outline = outlineOf(state.workspace.case);
		const requirements = items.flatMap((item) => requirementsOf(item, splits.get(item.id)));
		const pointed = pointedOf(requirements, await point(requirements, outline, ask), outline);
		const sentences = await ask(pointed.map(pointedQuestion), {
			stage: "check pointed",
			state: { process: PROCESS, stage: CHECK_POINTED, rules: RULES },
		});
		const whole = await ask(
			items.flatMap((item) => [meetsQuestion(item), missesQuestion(item)]),
			{ stage: "check items", extra: { process: PROCESS, stage: CHECK, rules: RULES } },
		);
		const found = { ...sentences, ...whole };
		const finals = items.map((item) => finalQuestion(item, checkLines(item, requirements, pointed, found)));
		return ask(finals, { stage: "decide", extra: { process: PROCESS, stage: DECIDE, rules: RULES } });
	};
}

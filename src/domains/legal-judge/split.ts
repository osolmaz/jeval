import type { Answer, Ask, ChoiceQuestion } from "../../core/index.ts";
import type { Item } from "./case.ts";
import { ACCEPT, acceptQuestion, PROCESS, SPLIT, windowQuestion } from "./prompts.ts";

/**
 * Splitting a rubric item into parts without changing its words. Code offers every word gap; Jev picks, in each
 * overlapping window of the item, the gap where a new requirement starts, or none. All windows go out in one request.
 * Picks are kept at a probability of 0.5 or more and merged with neighbours; then Jev confirms the split or rejects it.
 */
export const WINDOW = { size: 12, stride: 6, quote: 4, pick: 0.5, merge: 2, firstGap: 3 } as const;

export interface Split {
	readonly words: readonly string[];
	/** Word positions where a part starts, after the first. */
	readonly cuts: readonly number[];
	/** Jev's probability that the split is correct; null when the item has one part. */
	readonly accepted: number | null;
}

/** Splits made once per item text and reused for every answer to the same task. */
export class SplitCache {
	private readonly splits = new Map<string, Split>();

	get(text: string): Split | undefined {
		return this.splits.get(text);
	}

	set(text: string, split: Split): void {
		this.splits.set(text, split);
	}
}

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export function partsOf(split: Pick<Split, "words" | "cuts">): string[] {
	const bounds = [0, ...split.cuts, split.words.length];
	return bounds.slice(1).map((end, index) => split.words.slice(bounds[index], end).join(" "));
}

export function highlight(split: Pick<Split, "words" | "cuts">, index: number): string {
	return partsOf(split)
		.map((part, position) => (position === index ? `⟦${part}⟧` : part))
		.join(" ");
}

/** The overlapping windows of an item, each a choice among its gaps, quoted, or none. */
export function windowQuestions(item: Item, words: readonly string[]): ChoiceQuestion[] {
	const questions: ChoiceQuestion[] = [];
	for (let start = WINDOW.firstGap; start < words.length; start += WINDOW.stride) {
		const gaps: Record<string, string> = {};
		for (let gap = start; gap < Math.min(start + WINDOW.size, words.length); gap += 1) {
			const before = words.slice(Math.max(0, gap - WINDOW.quote), gap).join(" ");
			gaps[`g${String(gap)}`] = `Between "${before}" and "${words.slice(gap, gap + WINDOW.quote).join(" ")}"`;
		}
		const stretch = words.slice(Math.max(0, start - 3), start + WINDOW.size).join(" ");
		questions.push(windowQuestion(item, `${item.id}/w${String(start)}`, stretch, gaps));
	}
	return questions;
}

/** The gap a window picked, with its probability, or null for none or a weak pick. */
function pickOf(answer: Answer | undefined): readonly [number, number] | null {
	if (answer?.kind !== "choice" || !answer.choice.startsWith("g")) return null;
	const probability = answer.probabilities[answer.choice] ?? 0;
	return probability >= WINDOW.pick ? [Number(answer.choice.slice(1)), probability] : null;
}

/** The cuts that the window answers support: strong picks, merged with neighbouring picks into the strongest. */
export function cutsFrom(answers: Readonly<Record<string, Answer>>, questions: readonly ChoiceQuestion[]): number[] {
	const picks = new Map<number, number>();
	for (const pick of questions.map((question) => pickOf(answers[question.id]))) {
		if (pick !== null) picks.set(pick[0], Math.max(picks.get(pick[0]) ?? 0, pick[1]));
	}
	const cuts: number[] = [];
	for (const [gap] of [...picks].sort((a, b) => b[1] - a[1])) {
		if (!cuts.some((cut) => Math.abs(cut - gap) <= WINDOW.merge)) cuts.push(gap);
	}
	return cuts.sort((a, b) => a - b);
}

async function proposeCuts(item: Item, words: readonly string[], ask: Ask): Promise<number[]> {
	const questions = windowQuestions(item, words);
	if (questions.length === 0) return [];
	const answers = await ask(questions, {
		stage: `split ${item.id}`,
		state: { process: PROCESS, stage: SPLIT, item: item.text },
	});
	return cutsFrom(answers, questions);
}

async function confirm(
	proposed: readonly { item: Item; words: readonly string[]; cuts: number[] }[],
	ask: Ask,
): Promise<Map<string, number>> {
	const split = proposed.filter((entry) => entry.cuts.length > 0);
	if (split.length === 0) return new Map();
	const questions = split.map((entry) => acceptQuestion(entry.item, partsOf(entry)));
	const items = Object.fromEntries(split.map((entry) => [entry.item.id, entry.item.text]));
	const answers = await ask(questions, { stage: "accept splits", state: { process: PROCESS, stage: ACCEPT, items } });
	return new Map(split.map((entry) => [entry.item.id, probabilityOf(answers[`${entry.item.id}/accept`])]));
}

export const probabilityOf = (answer: Answer | undefined): number => (answer?.kind === "bool" ? answer.probability : 0);

/** Each item's split: from the cache, or proposed by the windows and confirmed in one request for all new splits. */
export async function splitItems(items: readonly Item[], ask: Ask, cache: SplitCache): Promise<Map<string, Split>> {
	const proposed = [];
	for (const item of items.filter((candidate) => cache.get(candidate.text) === undefined)) {
		const words = wordsOf(item.text);
		proposed.push({ item, words, cuts: await proposeCuts(item, words, ask) });
	}
	const accepted = await confirm(proposed, ask);
	for (const { item, words, cuts } of proposed)
		cache.set(item.text, { words, cuts, accepted: accepted.get(item.id) ?? null });
	return new Map(
		items.map((item) => [item.id, cache.get(item.text) ?? { words: wordsOf(item.text), cuts: [], accepted: null }]),
	);
}

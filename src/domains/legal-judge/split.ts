import { type Answer, type Ask, locateAll, type Node } from "../../core/index.ts";
import type { Item } from "./case.ts";
import { ACCEPT, acceptQuestion, NO_SPLIT, PROCESS, SPLIT, splitQuestion } from "./prompts.ts";

/**
 * Splitting a rubric item into parts without changing its words: Jev points at the word gaps where a new requirement
 * starts (`locateAll` over the item's gaps, shown in overlapping windows), and then confirms the split or rejects it.
 */
export const GAPS = { first: 3, quote: 4 } as const;

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

/** An item as a root whose children are its word gaps, each quoting the words around it. */
export function gapsOf(item: Item, words: readonly string[]): Node {
	const gaps: Node[] = [];
	for (let gap = GAPS.first; gap < words.length; gap += 1) {
		const before = words.slice(Math.max(0, gap - GAPS.quote), gap).join(" ");
		const after = words.slice(gap, gap + GAPS.quote).join(" ");
		gaps.push({ id: `${item.id}:${String(gap)}`, title: `Between "${before}" and "${after}"` });
	}
	return { id: item.id, title: item.text, children: () => gaps };
}

export const probabilityOf = (answer: Answer | undefined): number => (answer?.kind === "bool" ? answer.probability : 0);

const gapOf = (node: Node | undefined): number => Number(node?.id.split(":").at(-1));

interface Proposed {
	readonly item: Item;
	readonly words: readonly string[];
	readonly cuts: number[];
}

async function confirm(split: readonly Proposed[], ask: Ask): Promise<Map<string, number>> {
	if (split.length === 0) return new Map();
	const questions = split.map((entry) => acceptQuestion(entry.item, partsOf(entry)));
	const items = Object.fromEntries(split.map((entry) => [entry.item.id, entry.item.text]));
	const answers = await ask(questions, { stage: "accept splits", state: { process: PROCESS, stage: ACCEPT, items } });
	return new Map(split.map((entry) => [entry.item.id, probabilityOf(answers[`${entry.item.id}/accept`])]));
}

async function propose(fresh: readonly Item[], ask: Ask): Promise<Proposed[]> {
	if (fresh.length === 0) return [];
	const targets = fresh.map((item) => ({
		id: item.id,
		root: gapsOf(item, wordsOf(item.text)),
		question: splitQuestion(item),
	}));
	const items = Object.fromEntries(fresh.map((item) => [item.id, item.text]));
	const marked = await locateAll(ask, targets, {
		stage: "split",
		state: { process: PROCESS, stage: SPLIT, items },
		none: NO_SPLIT,
	});
	return fresh.map((item) => ({
		item,
		words: wordsOf(item.text),
		cuts: (marked.get(item.id) ?? []).map((pointer) => gapOf(pointer.path[0])),
	}));
}

/** Each item's split: from the cache, or pointed out for all new items at once and then confirmed at once. */
export async function splitItems(items: readonly Item[], ask: Ask, cache: SplitCache): Promise<Map<string, Split>> {
	const proposed = await propose(
		items.filter((item) => cache.get(item.text) === undefined),
		ask,
	);
	const accepted = await confirm(
		proposed.filter((entry) => entry.cuts.length > 0),
		ask,
	);
	for (const { item, words, cuts } of proposed)
		cache.set(item.text, { words, cuts, accepted: accepted.get(item.id) ?? null });
	return new Map(
		items.map((item) => [item.id, cache.get(item.text) ?? { words: wordsOf(item.text), cuts: [], accepted: null }]),
	);
}

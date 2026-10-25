import type { Answer, JudgeContext } from "../../core/index.ts";
import type { Item } from "./case.ts";
import { CHECK, meetsQuestion, missesQuestion, PROCESS, RULES } from "./prompts.ts";
import type { Workspace } from "./workspace.ts";

const probability = (answer: Answer | undefined): number => (answer?.kind === "bool" ? answer.probability : 0);

/**
 * An item passes only when Jev says the answer meets it and says it misses nothing: its probability is the smaller of
 * P(meets) and 1 - P(misses), so it is 0.5 or more exactly when both checks pass.
 */
export function combine(item: Item, found: Readonly<Record<string, Answer>>): Answer {
	const meets = probability(found[`${item.id}/meets`]);
	const missesNothing = 1 - probability(found[`${item.id}/misses`]);
	return { kind: "bool", probability: Math.min(meets, missesNothing) };
}

/**
 * Asks two questions per item over the evidence, whether the answer meets the item and whether it misses or
 * contradicts any requirement, and combines them. Asking both ways catches an answer that covers most of an item but
 * misses one requirement, which the first question alone tends to pass.
 */
export async function meetsAndMisses({
	state,
	ask,
}: JudgeContext<Workspace>): Promise<Readonly<Record<string, Answer>>> {
	const items = state.workspace.case.items;
	const found = await ask(
		items.flatMap((item) => [meetsQuestion(item), missesQuestion(item)]),
		{ stage: "check", extra: { process: PROCESS, stage: CHECK, rules: RULES } },
	);
	return Object.fromEntries(items.map((item) => [item.id, combine(item, found)]));
}

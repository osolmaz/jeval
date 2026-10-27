import type { Answer, AnswerContext } from "../../core/index.ts";
import type { Item } from "./case.ts";
import { itemQuestions, type JudgeDefinition } from "./definition.ts";
import type { World } from "./world.ts";

const probability = (answer: Answer | undefined): number => (answer?.type === "bool" ? answer.probability : 0);

/**
 * An item passes only when every question that counts for it says yes and every question that counts against it says
 * no: its probability is the smallest of P(yes) for the first kind and 1 - P(yes) for the second.
 */
export function combine(definition: JudgeDefinition, item: Item, found: Readonly<Record<string, Answer>>): Answer {
	const parts = definition.questions.map((question) => {
		const yes = probability(found[`${item.id}/${question.id}`]);
		return question.counts === "for" ? yes : 1 - yes;
	});
	return { type: "bool", probability: Math.min(...parts) };
}

/** Asks the definition's questions about every item over the evidence, in one stage, and combines the answers. */
export function judgeWith(definition: JudgeDefinition) {
	const { process, check, rules } = definition.texts;
	return async ({ world, ask }: AnswerContext<World>): Promise<Readonly<Record<string, Answer>>> => {
		const items = world.case.items;
		const found = await ask(
			items.flatMap((item) => itemQuestions(definition, item)),
			{ stage: "check", extra: { process, stage: check, rules } },
		);
		return Object.fromEntries(items.map((item) => [item.id, combine(definition, item, found)]));
	};
}

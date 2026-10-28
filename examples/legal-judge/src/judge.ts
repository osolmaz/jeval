import type { Answer, AnswerContext } from "@osolmaz/switch";
import type { Item, LegalCase } from "./case.ts";
import { itemQuestions, type JudgeDefinition } from "./definition.ts";
import type { LegalState } from "./state.ts";

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

/** Asks the definition's questions about every item of the case over the evidence, in one stage, and combines them. */
export function judgeWith(definition: JudgeDefinition, legalCase: LegalCase) {
	const { process, check, rules } = definition.texts;
	return async ({ ask }: AnswerContext<LegalState>): Promise<Readonly<Record<string, Answer>>> => {
		const items = legalCase.items;
		const found = await ask(
			items.flatMap((item) => itemQuestions(definition, item)),
			{ stage: "check", extra: { process, stage: check, rules } },
		);
		return Object.fromEntries(items.map((item) => [item.id, combine(definition, item, found)]));
	};
}

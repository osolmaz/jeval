import { type Answer, type AnswerContext, type Answers, estimateTokens, type StageView } from "@osolmaz/switch";
import type { Item } from "./case.ts";
import { itemQuestions, type JudgeDefinition } from "./definition.ts";
import type { CaseFolder, JudgeState } from "./state.ts";
import { view } from "./view.ts";

const probability = (answer: Answer | undefined): number => (answer?.type === "bool" ? answer.probability : 0);

/**
 * An item passes only when every question that counts for it says yes and every question that counts against it says
 * no: its probability is the smallest of P(yes) for the first sort and 1 - P(yes) for the second.
 */
export function combine(definition: JudgeDefinition, item: Item, found: Answers): Answer {
	const parts = definition.questions.map((question) => {
		const yes = probability(found[`${item.id}/${question.id}`]);
		return question.counts === "for" ? yes : 1 - yes;
	});
	return { type: "bool", probability: Math.min(...parts) };
}

/** What the model reads for the checks: the view for the answers, with the process, the checking stage and the rules. */
function checkView(definition: JudgeDefinition, folder: CaseFolder, state: JudgeState): StageView {
	const { process, check, rules } = definition.texts;
	const texts = { process, stage: check, rules };
	return async (tokens, charsPerToken) => {
		const room = tokens - estimateTokens(texts, charsPerToken);
		const base = await view(definition.texts, folder, state, "answer", room, charsPerToken);
		return { ...base, decisionState: { ...base.decisionState, ...texts } };
	};
}

/** Asks the definition's questions about every item of the case over the evidence, in one stage, and combines them. */
export function judgeWith(definition: JudgeDefinition, folder: CaseFolder) {
	return async ({ state, ask }: AnswerContext<JudgeState>): Promise<Answers> => {
		const { items } = folder.case;
		const questions = Object.fromEntries(items.flatMap((item) => itemQuestions(definition, item)));
		const found = await ask(questions, { stage: "check", view: checkView(definition, folder, state) });
		return Object.fromEntries(items.map((item) => [item.id, combine(definition, item, found)]));
	};
}

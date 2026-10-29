import type { Answer, Choice, ChoiceQuestion, Json, JsonObject, Question, StateMachine } from "./types.ts";

/** The id of the pick question that `picking` asks, unless its domain names another. */
export const PICK_ID = "pick";

/** A choice function gave choices that a pick cannot offer: two with one key or one text, or none to pick from. */
export class ChoiceError extends Error {
	override readonly name = "ChoiceError";
}

/**
 * The choices that the model sees in a state: the choice function's choices, checked, and at most `room` of them, the
 * ones of lowest priority value, in the order the choice function gave them.
 */
export function offerChoices<C extends Choice>(choices: readonly C[], room: number): readonly C[] {
	const keys = new Set<string>();
	const texts = new Set<string>();
	for (const choice of choices) {
		if (keys.has(choice.key)) throw new ChoiceError(`two choices share the key ${choice.key}`);
		if (texts.has(choice.text)) throw new ChoiceError(`two choices share the text "${choice.text}"`);
		keys.add(choice.key);
		texts.add(choice.text);
	}
	const kept = new Set(
		choices
			.map((choice, index) => ({ priority: choice.priority ?? 0, index }))
			.sort((a, b) => a.priority - b.priority || a.index - b.index)
			.slice(0, Math.max(0, room))
			.map(({ index }) => index),
	);
	return choices.filter((_, index) => kept.has(index));
}

/** A pick of a state: its choice question, and the choices behind the question's labels, in their order. */
export interface PickQuestion<C extends Choice> {
	readonly question: ChoiceQuestion;
	readonly choices: readonly C[];
}

/** The label of the `index`-th choice of a pick. */
const labelOf = (index: number): string => `o${String(index + 1)}`;

/**
 * The pick question over `choices`, or null when there are none: at most `limit` of them, under short labels, because
 * a choice's key can be long, such as a move's, and the labels keep the request small. The question's `data` says
 * what each label stands for, and how many choices the limit cut.
 */
export function pickQuestion<C extends Choice>(
	choices: readonly C[],
	instructions: string,
	limit: number,
): PickQuestion<C> | null {
	const offered = offerChoices(choices, limit);
	if (offered.length === 0) return null;
	const criteria = Object.fromEntries(offered.map((choice, index) => [labelOf(index), choice.text]));
	const labels: Record<string, JsonObject> = Object.fromEntries(
		offered.map(({ key, type, data }, index) => [
			labelOf(index),
			data === undefined ? { key, type } : { key, type, data },
		]),
	);
	const cut = choices.length - offered.length;
	const data = cut > 0 ? { choices: labels, cut } : { choices: labels };
	return { question: { type: "choice", instructions, criteria, data }, choices: offered };
}

const isObject = (value: Json | undefined): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The key behind each label of a pick, from the facts that `pickQuestion` writes into its question; null for a
 * question that is no pick. This is how the loop and the tools that read a trace tell a pick from other questions.
 */
export function pickKeys(question: Question | undefined): Map<string, string> | null {
	const choices = question?.type === "choice" ? question.data?.["choices"] : undefined;
	if (!isObject(choices)) return null;
	const keys = new Map<string, string>();
	for (const [label, facts] of Object.entries(choices)) {
		const key = isObject(facts) ? facts["key"] : undefined;
		if (typeof key === "string") keys.set(label, key);
	}
	return keys;
}

/** The choice that `answer` picked in `pick`. */
export function pickedChoice<C extends Choice>(pick: PickQuestion<C>, answer: Answer | undefined): C {
	if (answer?.type !== "choice") throw new ChoiceError("the pick has no choice answer");
	const choice = pick.choices[Object.keys(pick.question.criteria).indexOf(answer.choice)];
	if (choice === undefined) throw new ChoiceError(`the label ${answer.choice} is none of the pick's choices`);
	return choice;
}

/** What a machine that picks in each state needs: the choices and the transition of a picked choice. */
export interface PickSpec<S, C extends Choice> {
	/** The pick question's instructions. */
	readonly instructions: string;
	/** The most choices that one pick shows: the ones of lowest priority value stay. */
	readonly limit: number;
	/** The id of the pick question; `pick` by default. */
	readonly id?: string;
	/** The choice function: the choices in a state. A state with none asks nothing, so the run ends there. */
	choices(state: S): readonly C[];
	/** The state after the model picked `choice` in `state`. */
	transition(state: S, choice: C): Promise<S>;
}

/**
 * The question function and the transition function of a machine that asks one pick in each state: the pick question
 * over the state's choices, and the transition of the picked one. A state with no choices asks nothing.
 */
export function picking<S extends JsonObject, C extends Choice>(
	spec: PickSpec<S, C>,
): Pick<StateMachine<S>, "questions" | "transition"> {
	const id = spec.id ?? PICK_ID;
	const pickIn = (state: S) => pickQuestion(spec.choices(state), spec.instructions, spec.limit);
	return {
		questions: (state) => {
			const pick = pickIn(state);
			return pick === null ? {} : { [id]: pick.question };
		},
		transition: (state, answers) => {
			const pick = pickIn(state);
			if (pick === null) throw new ChoiceError("the state has no choices to pick from");
			return spec.transition(state, pickedChoice(pick, answers[id]));
		},
	};
}

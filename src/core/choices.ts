import { STOP_KEY } from "./trace.ts";
import type { Choice } from "./types.ts";

/** A choice function gave choices that the core cannot offer: two with one key or one text, or one picked before. */
export class ChoiceError extends Error {
	override readonly name = "ChoiceError";
}

/**
 * The choices that the model sees in a state, without stop: the choice function's choices, checked, and at most `room`
 * of them, the ones of lowest priority value, in the order the choice function gave them.
 */
export function offerChoices<C extends Choice>(
	choices: readonly C[],
	picked: ReadonlySet<string>,
	room: number,
): readonly C[] {
	assertOffered(choices, picked);
	return cut(choices, room);
}

function assertOffered(choices: readonly Choice[], picked: ReadonlySet<string>): void {
	const keys = new Set<string>();
	const texts = new Set<string>();
	for (const choice of choices) {
		if (choice.key === STOP_KEY) throw new ChoiceError(`the key ${STOP_KEY} belongs to the stop choice`);
		if (picked.has(choice.key)) throw new ChoiceError(`the choice ${choice.key} was picked before in this run`);
		if (keys.has(choice.key)) throw new ChoiceError(`two choices share the key ${choice.key}`);
		if (texts.has(choice.text)) throw new ChoiceError(`two choices share the text "${choice.text}"`);
		keys.add(choice.key);
		texts.add(choice.text);
	}
}

function cut<C extends Choice>(choices: readonly C[], room: number): readonly C[] {
	const kept = new Set(
		choices
			.map((choice, index) => ({ priority: choice.priority ?? 0, index }))
			.sort((a, b) => a.priority - b.priority || a.index - b.index)
			.slice(0, Math.max(0, room))
			.map(({ index }) => index),
	);
	return choices.filter((_, index) => kept.has(index));
}

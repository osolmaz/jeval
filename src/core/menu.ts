import type { Choice, Menu, Step } from "./types.ts";

export class MenuError extends Error {
	override readonly name = "MenuError";
}

/**
 * The menu of the current step: the domain's choices without the ones already taken. At most `room` choices are kept:
 * the ones of lowest priority value, in the order the domain listed them.
 */
export function buildMenu<W>(menu: Menu<W>, world: W, history: readonly Step[], room: number): readonly Choice[] {
	const taken = new Set(history.map((step) => step.key));
	const choices = menu(world, history).filter((choice) => !taken.has(choice.key));
	assertUnique(choices);
	return cut(choices, room);
}

function assertUnique(choices: readonly Choice[]): void {
	const keys = new Set<string>();
	const texts = new Set<string>();
	for (const choice of choices) {
		if (keys.has(choice.key)) throw new MenuError(`two choices share the key ${choice.key}`);
		if (texts.has(choice.text)) throw new MenuError(`two choices share the text "${choice.text}"`);
		keys.add(choice.key);
		texts.add(choice.text);
	}
}

function cut(choices: readonly Choice[], room: number): readonly Choice[] {
	const kept = new Set(
		choices
			.map((choice, index) => ({ priority: choice.priority, index }))
			.sort((a, b) => a.priority - b.priority || a.index - b.index)
			.slice(0, Math.max(0, room))
			.map(({ index }) => index),
	);
	return choices.filter((_, index) => kept.has(index));
}

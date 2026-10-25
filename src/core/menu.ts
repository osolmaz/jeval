import type { Action, MenuItem, State } from "./types.ts";

export class MenuError extends Error {
	override readonly name = "MenuError";
}

/**
 * The options of every action that are available now, without the steps already taken. At most `room` options are
 * kept: the ones of lowest priority value, shown in the order the actions listed them.
 */
export function buildMenu<W>(actions: readonly Action<W>[], state: State<W>, room: number): readonly MenuItem[] {
	const taken = new Set(state.log.map((entry) => entry.key));
	const items = actions.flatMap((action) => action.items(state)).filter((item) => !taken.has(item.key));
	assertUnique(items);
	return cut(items, room);
}

function assertUnique(items: readonly MenuItem[]): void {
	const keys = new Set<string>();
	const texts = new Set<string>();
	for (const item of items) {
		if (keys.has(item.key)) throw new MenuError(`two options share the key ${item.key}`);
		if (texts.has(item.text)) throw new MenuError(`two options share the text "${item.text}"`);
		keys.add(item.key);
		texts.add(item.text);
	}
}

function cut(items: readonly MenuItem[], room: number): readonly MenuItem[] {
	const kept = new Set(
		items
			.map((item, index) => ({ priority: item.priority, index }))
			.sort((a, b) => a.priority - b.priority || a.index - b.index)
			.slice(0, Math.max(0, room))
			.map(({ index }) => index),
	);
	return items.filter((_, index) => kept.has(index));
}

import type { JsonObject, Menu, Observation, Step } from "./types.ts";

/** One choice of a kind, before the core wraps it: its key within the kind, the text the model reads, and its argument. */
export interface TypedChoice<A> {
	readonly key: string;
	readonly text: string;
	readonly arg: A;
	readonly priority?: number;
	/** Facts about the choice for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
}

/** One kind of choice, with a typed argument. */
export interface ChoiceKind<W, A> {
	readonly name: string;
	/** Whether the kind is on the menu at all; when it is missing, `menu` decides alone. */
	when?(world: W, history: readonly Step[]): boolean;
	/** This kind's choices for the current step. */
	menu(world: W, history: readonly Step[]): readonly TypedChoice<A>[];
	/** Runs a chosen choice. A choice only reads the world. */
	run(world: W, arg: A): Observation | Promise<Observation>;
}

/** The menu of one kind. The argument type stays inside, so a domain can join kinds of any arguments. */
export function choiceKind<W, A>(spec: ChoiceKind<W, A>): Menu<W> {
	return (world, history) => {
		if (spec.when !== undefined && !spec.when(world, history)) return [];
		return spec.menu(world, history).map((choice) => ({
			kind: spec.name,
			key: `${spec.name}:${choice.key}`,
			text: choice.text,
			priority: choice.priority ?? 0,
			...(choice.data === undefined ? {} : { data: choice.data }),
			run: () => Promise.resolve(spec.run(world, choice.arg)),
		}));
	};
}

/** Several menus as one, in their order. */
export function joinMenus<W>(...menus: readonly Menu<W>[]): Menu<W> {
	return (world, history) => menus.flatMap((menu) => menu(world, history));
}

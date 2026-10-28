import type { Choice, JsonObject, StateMachine } from "./types.ts";

/** One choice of a type, before `choiceType` adds its type: its key within the type, the text, and its argument. */
export interface TypedChoice<A> {
	readonly key: string;
	readonly text: string;
	readonly arg: A;
	readonly priority?: number;
	/** Facts about the choice for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
}

/** One type of choice: its part of the choice function and its part of the transition function, with a typed argument. */
export interface ChoiceTypeSpec<S, A> {
	readonly type: string;
	/** This type's choices in a state. */
	choices(state: S): readonly TypedChoice<A>[];
	/** The state after the model picked one of this type's choices. */
	transition(state: S, arg: A): S | Promise<S>;
}

/** A choice that carries the transition of its type, as `choiceType` makes it. */
export interface BoundChoice<S> extends Choice {
	readonly next: (state: S) => Promise<S>;
}

/** One type of choice as `joinTypes` takes it. The argument type stays inside, so types of any arguments can join. */
export type ChoiceType<S> = (state: S) => readonly BoundChoice<S>[];

/** One type of choice, ready to join: each of its choices gets the type in its key and carries its transition. */
export function choiceType<S, A>(spec: ChoiceTypeSpec<S, A>): ChoiceType<S> {
	return (state) =>
		spec.choices(state).map((choice) => ({
			type: spec.type,
			key: `${spec.type}:${choice.key}`,
			text: choice.text,
			...(choice.priority === undefined ? {} : { priority: choice.priority }),
			...(choice.data === undefined ? {} : { data: choice.data }),
			next: (from: S) => Promise.resolve(spec.transition(from, choice.arg)),
		}));
}

/** The choice function and the transition function of several types of choice, with the types' choices in this order. */
export function joinTypes<S extends JsonObject>(
	...types: readonly ChoiceType<S>[]
): Pick<StateMachine<S, BoundChoice<S>>, "choices" | "transition"> {
	return {
		choices: (state) => types.flatMap((type) => type(state)),
		transition: (state, choice) => choice.next(state),
	};
}

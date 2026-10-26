import type { Action, JsonObject, Observation, State } from "./types.ts";

/** One concrete choice of an action: its key within the action, the text the model reads, and its argument. */
export interface Option<A> {
	readonly key: string;
	readonly text: string;
	readonly arg: A;
	readonly informs?: readonly string[];
	readonly priority?: number;
	/** Facts about the option for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
}

/** An action schema with a typed argument. */
export interface ActionSpec<W, A> {
	readonly name: string;
	/** Whether the action is available at all; when it is missing, `options` decides alone. */
	when?(state: State<W>): boolean;
	options(state: State<W>): readonly Option<A>[];
	/** Runs the chosen option. Actions only read the workspace. */
	observe(workspace: W, arg: A): Observation | Promise<Observation>;
}

/** Declares an action. The argument type stays inside the declaration, so a domain can list any actions together. */
export function action<W, A>(spec: ActionSpec<W, A>): Action<W> {
	return {
		name: spec.name,
		items(state) {
			if (spec.when !== undefined && !spec.when(state)) return [];
			return spec.options(state).map((option) => ({
				action: spec.name,
				key: `${spec.name}:${option.key}`,
				text: option.text,
				informs: option.informs ?? [],
				priority: option.priority ?? 0,
				...(option.data === undefined ? {} : { data: option.data }),
				run: () => Promise.resolve(spec.observe(state.workspace, option.arg)),
			}));
		},
	};
}

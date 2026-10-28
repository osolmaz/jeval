import { STOP_KEY, startOf, type TraceEntry } from "./trace.ts";
import type { Answers, Decider, Ending, JsonObject } from "./types.ts";

export class ReplayError extends Error {
	override readonly name = "ReplayError";
}

type PickEntry = Extract<TraceEntry, { type: "pick" }>;

/**
 * What a run takes again from a recorded trace. The run repeats the recorded picks by their keys and takes the recorded
 * states, so no transition runs and the model is not asked, for the first `steps` steps.
 */
export interface Replay {
	/** What the recorded run was: its domain, definition, case and model, and the limits, which the run takes. */
	readonly start: Extract<TraceEntry, { type: "start" }>;
	readonly steps: number;
	/** The recorded states by step: the initial state first. */
	readonly states: readonly JsonObject[];
	/** The recorded picks by step: the first step's pick first. */
	readonly picks: readonly PickEntry[];
	/** How the recorded steps ended, which the run repeats; null for a fork, after which the model goes on. */
	readonly ending: Ending | null;
	/** The recorded answers by question id, which the run repeats; null when the model answers again. */
	readonly answers: Answers | null;
	/** Why the recorded answers failed, which the run repeats; null when they did not, or when the model answers again. */
	readonly answersError: string | null;
}

export interface ReplayOptions {
	/** Repeat only this many steps: the model picks after them, and answers. */
	readonly fork?: number;
	/** Repeat every step and how the steps ended, and ask the model only the questions again. */
	readonly askAgain?: boolean;
}

/** What a run repeats of the trace `entries`: every step and the answers, every step only, or the steps of a fork. */
export function replayOf(entries: readonly TraceEntry[], options: ReplayOptions = {}): Replay {
	const start = startOf(entries);
	const states = statesOf(entries);
	const picks = entries.filter((entry) => entry.type === "pick");
	if (options.fork !== undefined) {
		const most = forkable(picks, states);
		if (options.fork > most) {
			throw new ReplayError(
				`the trace has ${String(most)} steps that a fork can repeat, fewer than the fork's ${String(options.fork)}`,
			);
		}
		return { start, steps: options.fork, states, picks, ending: null, answers: null, answersError: null };
	}
	const ended = entries.find((entry) => entry.type === "ended");
	if (ended === undefined) throw new ReplayError("the trace's steps did not end: its run stopped before");
	const steps = { start, steps: picks.length, states, picks, ending: ended.ended };
	if (options.askAgain === true) return { ...steps, answers: null, answersError: null };
	const final = entries.find((entry) => entry.type === "answers");
	if (final === undefined) throw new ReplayError("the trace has no answers: its run stopped before them");
	return { ...steps, answers: answersOf(entries), answersError: final.error };
}

/** How many steps a fork can repeat: each with its pick and the state after it, which only a last pick of stop lacks. */
const forkable = (picks: readonly PickEntry[], states: readonly JsonObject[]): number =>
	picks.at(-1)?.choice === STOP_KEY ? picks.length : Math.min(picks.length, states.length - 1);

/** The recorded states in order of their steps; each step from 0 on must have one. */
function statesOf(entries: readonly TraceEntry[]): JsonObject[] {
	const states: JsonObject[] = [];
	for (const entry of entries) {
		if (entry.type !== "state") continue;
		if (entry.step !== states.length) throw new ReplayError(`the trace's states skip to step ${String(entry.step)}`);
		states.push(entry.state);
	}
	return states;
}

/** Every recorded answer by question id, from every answer stage and the final answers. */
function answersOf(entries: readonly TraceEntry[]): Answers {
	return Object.fromEntries(
		entries.flatMap((entry) =>
			entry.type === "stage" || entry.type === "answers" ? Object.entries(entry.answers ?? {}) : [],
		),
	);
}

/** The recorded state after `step` steps. */
export function recordedState(replay: Replay, step: number): JsonObject {
	const state = replay.states[step];
	if (state === undefined) throw new ReplayError(`the trace has no state after step ${String(step)}`);
	return state;
}

/** The recorded pick of `step`. */
export function recordedPick(replay: Replay, step: number): PickEntry {
	const pick = replay.picks[step - 1];
	if (pick === undefined) throw new ReplayError(`the trace has no pick at step ${String(step)}`);
	return pick;
}

/**
 * The decider of a replay that repeats everything: the trace's model, which is never asked, since the run takes the
 * picks and the answers from the trace.
 */
export function recordedModel(entries: readonly TraceEntry[]): Decider {
	return {
		model: startOf(entries).model,
		window: Number.MAX_SAFE_INTEGER,
		charsPerToken: 3,
		decide: () => Promise.reject(new ReplayError("a replay of the whole trace asks the model nothing")),
	};
}

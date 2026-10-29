import { startOf, type TraceEntry } from "./trace.ts";
import type { Answers, Decider, Ending, JsonObject, Questions } from "./types.ts";

export class ReplayError extends Error {
	override readonly name = "ReplayError";
}

/** One recorded step: the questions that the model answered, and its answers. */
export interface RecordedStep {
	readonly questions: Questions;
	readonly answers: Answers;
}

/** How a recorded run ended: why, after how many steps, and why it failed. */
export interface RecordedEnd {
	readonly ended: Ending;
	readonly steps: number;
	readonly error: string | null;
}

/**
 * What a run takes again from a recorded trace. The run repeats the recorded answers and takes the recorded states, so
 * no transition runs and the model is not asked, for the recorded steps that it repeats.
 */
export interface Replay {
	/** What the recorded run was: its domain, definition, case and model, and the limits, which the run takes. */
	readonly start: Extract<TraceEntry, { type: "start" }>;
	/** The recorded states by step: the initial state first. */
	readonly states: readonly JsonObject[];
	/** The recorded steps that the run repeats: the first step first. */
	readonly steps: readonly RecordedStep[];
	/** How the recorded run ended, which the run repeats; null for a fork, after which the model goes on. */
	readonly ending: RecordedEnd | null;
}

export interface ReplayOptions {
	/** Repeat only this many steps: the model answers after them. */
	readonly fork?: number;
}

/** What a run repeats of the trace `entries`: the whole run, or the first steps of a fork. */
export function replayOf(entries: readonly TraceEntry[], options: ReplayOptions = {}): Replay {
	const start = startOf(entries);
	const states = statesOf(entries);
	const steps = stepsOf(entries);
	if (options.fork !== undefined) {
		// A fork repeats a step with its answers and the state after it.
		const most = Math.min(steps.length, states.length - 1);
		if (options.fork > most) {
			throw new ReplayError(
				`the trace has ${String(most)} steps that a fork can repeat, fewer than the fork's ${String(options.fork)}`,
			);
		}
		return { start, states, steps: steps.slice(0, options.fork), ending: null };
	}
	const ended = entries.find((entry) => entry.type === "ended");
	if (ended === undefined) throw new ReplayError("the trace's run did not end: it stopped before");
	return { start, states, steps, ending: { ended: ended.ended, steps: ended.steps, error: ended.error } };
}

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

/** The recorded steps that have answers, in order: each with the questions of its step. */
function stepsOf(entries: readonly TraceEntry[]): RecordedStep[] {
	const asked = new Map<number, Questions>();
	const steps: RecordedStep[] = [];
	for (const entry of entries) {
		if (entry.type === "questions") asked.set(entry.step, entry.questions);
		if (entry.type !== "answers") continue;
		if (entry.step !== steps.length + 1)
			throw new ReplayError(`the trace's answers skip to step ${String(entry.step)}`);
		const questions = asked.get(entry.step);
		if (questions === undefined) throw new ReplayError(`the trace has no questions of step ${String(entry.step)}`);
		steps.push({ questions, answers: entry.answers });
	}
	return steps;
}

/** The recorded state after `step` steps. */
export function recordedState(replay: Replay, step: number): JsonObject {
	const state = replay.states[step];
	if (state === undefined) throw new ReplayError(`the trace has no state after step ${String(step)}`);
	return state;
}

/**
 * The decider of a replay that repeats everything: the trace's model, which is never asked, since the run takes every
 * answer from the trace.
 */
export function recordedModel(entries: readonly TraceEntry[]): Decider {
	return {
		model: startOf(entries).model,
		window: Number.MAX_SAFE_INTEGER,
		charsPerToken: 3,
		decide: () => Promise.reject(new ReplayError("a replay of the whole trace asks the model nothing")),
	};
}

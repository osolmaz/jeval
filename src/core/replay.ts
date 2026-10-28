import { STOP_KEY, type TraceEntry } from "./trace.ts";
import type { Answer, ChoiceQuestion, Decider, DecisionRequest, DecisionResult, JsonObject } from "./types.ts";

export class ReplayError extends Error {
	override readonly name = "ReplayError";
}

const NO_USAGE = { inputTokens: 0, milliseconds: 0 } as const;

/** What a run takes again from a trace: the recorded states up to step `steps`. */
export interface Replay {
	readonly steps: number;
	/** The recorded states by step: the initial state first. */
	readonly states: readonly JsonObject[];
}

/**
 * Repeats a recorded trace. The decider repeats its picks and the replay gives the run its states, so no transition
 * runs again. With `fork`, both stop after `fork.steps` steps, and `fork.then` decides and answers from there: a fork
 * of the trace at that step. Without it, the decider also repeats the recorded answers.
 */
export function replayOf(entries: readonly TraceEntry[], fork?: Fork): { decider: Decider; replay: Replay } {
	const decider = replayDecider(entries, fork);
	const states = statesOf(entries);
	const steps = fork?.steps ?? entries.filter((entry) => entry.type === "pick").length;
	return { decider, replay: { steps, states } };
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

/** The recorded state after `step` steps. */
export function recordedState(replay: Replay, step: number): JsonObject {
	const state = replay.states[step];
	if (state === undefined) throw new ReplayError(`the trace has no state after step ${String(step)}`);
	return state;
}

/**
 * A decider that repeats the picks of a recorded trace. With `then`, the replay stops after `steps` picks and `then`
 * decides from there on, and answers the questions. Without `then`, it also repeats the recorded answers.
 */
function replayDecider(entries: readonly TraceEntry[], fork?: Fork): Decider {
	const first = entries[0];
	if (first?.type !== "start") throw new ReplayError("a trace starts with its start entry");
	const recording = recordingOf(entries);
	if (fork === undefined) {
		const progress = { made: 0, limit: recording.picks.length };
		return {
			model: first.model,
			window: Number.MAX_SAFE_INTEGER,
			charsPerToken: 4,
			decide: (request) => replay(request, recording, progress, undefined),
		};
	}
	const { then } = fork;
	const progress = { made: 0, limit: fork.steps };
	return {
		model: then.model,
		window: then.window,
		charsPerToken: then.charsPerToken,
		decide: (request) => replay(request, recording, progress, then),
	};
}

function recordingOf(entries: readonly TraceEntry[]): Recording {
	const stages = entries.filter((entry) => entry.type === "stage" || entry.type === "answers");
	return {
		choices: entries.filter((entry) => entry.type === "choices"),
		picks: entries.filter((entry) => entry.type === "pick"),
		answers: stages.length === 0 ? null : new Map(stages.flatMap((entry) => Object.entries(entry.answers))),
	};
}

export interface Fork {
	/** How many recorded picks to repeat before `then` decides. */
	readonly steps: number;
	readonly then: Decider;
}

type ChoicesEntry = Extract<TraceEntry, { type: "choices" }>;
type PickEntry = Extract<TraceEntry, { type: "pick" }>;
interface Recording {
	readonly choices: readonly ChoicesEntry[];
	readonly picks: readonly PickEntry[];
	/** Every recorded answer by question id, from every answer stage and the final answers. */
	readonly answers: ReadonlyMap<string, Answer> | null;
}

const nextQuestion = (request: DecisionRequest): ChoiceQuestion | null => {
	const question = request.questions[0];
	return question?.type === "choice" && question.id === "next" ? question : null;
};

function replay(
	request: DecisionRequest,
	recording: Recording,
	progress: { made: number; readonly limit: number },
	then: Decider | undefined,
): Promise<DecisionResult> {
	const next = nextQuestion(request);
	if (next !== null && progress.made < progress.limit) {
		progress.made += 1;
		return Promise.resolve(
			repeatPick(next, recording.choices[progress.made - 1], recording.picks[progress.made - 1]),
		);
	}
	if (then !== undefined) return then.decide(request);
	return Promise.resolve(next === null ? repeatAnswers(request, recording.answers) : stopPick(next));
}

/** The recorded pick, as an answer to the run's own pick question; the pick must be among the choices again. */
function repeatPick(
	question: ChoiceQuestion,
	choices: ChoicesEntry | undefined,
	pick: PickEntry | undefined,
): DecisionResult {
	if (choices === undefined || pick === undefined) throw new ReplayError("the trace has fewer picks than the run");
	const text = choices.choices.find((choice) => choice.key === pick.key)?.text;
	const label = Object.entries(question.choices).find(([, choiceText]) => choiceText === text)?.[0];
	if (label === undefined) throw new ReplayError(`the recorded pick ${pick.key} is not among the choices any more`);
	return {
		ok: true,
		answers: { [question.id]: { type: "choice", choice: label, probabilities: { [label]: 1 } } },
		usage: NO_USAGE,
	};
}

function stopPick(question: ChoiceQuestion): DecisionResult {
	return {
		ok: true,
		answers: { [question.id]: { type: "choice", choice: STOP_KEY, probabilities: { [STOP_KEY]: 1 } } },
		usage: NO_USAGE,
	};
}

function repeatAnswers(request: DecisionRequest, recorded: ReadonlyMap<string, Answer> | null): DecisionResult {
	if (recorded === null) throw new ReplayError("the trace has no answers to repeat");
	const answers: Record<string, Answer> = {};
	for (const question of request.questions) {
		const known = recorded.get(question.id);
		if (known === undefined) throw new ReplayError(`the trace has no answer for ${question.id}`);
		answers[question.id] = known;
	}
	return { ok: true, answers, usage: NO_USAGE };
}

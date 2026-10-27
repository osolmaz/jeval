import { STOP_KEY, type TraceEntry } from "./trace.ts";
import type {
	Answer,
	ChoiceQuestion,
	Decider,
	DecisionRequest,
	DecisionResult,
	Domain,
	Entry,
	MenuItem,
	Observation,
} from "./types.ts";

export class ReplayError extends Error {
	override readonly name = "ReplayError";
}

const NO_USAGE = { inputTokens: 0, milliseconds: 0 } as const;

type ObservationEntry = Extract<TraceEntry, { type: "observation" }>;

/** What a run takes again from a trace: the observations of the start and of the first `steps` steps. */
export interface Replay {
	readonly steps: number;
	/** The recorded observations by step; step 0 holds the start's. */
	readonly observations: ReadonlyMap<number, readonly ObservationEntry[]>;
}

/**
 * Repeats a recorded trace. The decider repeats its choices and the replay gives the run its observations, so no
 * action runs again. With `fork`, both stop after `fork.steps` steps, and `fork.then` decides and answers from there:
 * a fork of the trace at that step. Without it, the decider also repeats the recorded answers.
 */
export function replayOf(entries: readonly TraceEntry[], fork?: Fork): { decider: Decider; replay: Replay } {
	const decider = replayDecider(entries, fork);
	const observations = new Map<number, ObservationEntry[]>();
	for (const entry of entries) {
		if (entry.type === "observation") observations.set(entry.step, [...(observations.get(entry.step) ?? []), entry]);
	}
	const steps = fork?.steps ?? entries.filter((entry) => entry.type === "choice").length;
	return { decider, replay: { steps, observations } };
}

/**
 * The observations a run starts with: the recorded ones while it replays a trace. A trace keeps only the labels of
 * images, so when the recorded start has images, the domain's start runs again and must find the same.
 */
export async function startOf<W>(
	domain: Domain<W>,
	workspace: W,
	replay: Replay | undefined,
): Promise<readonly Entry[]> {
	if (replay === undefined) return domain.start(workspace);
	const recorded = replay.observations.get(0) ?? [];
	if (recorded.every((entry) => entry.images.length === 0)) {
		return recorded.map((entry) => ({ action: entry.action, key: entry.key, observation: observationOf(entry) }));
	}
	const again = await domain.start(workspace);
	if (again.length !== recorded.length) throw new ReplayError("the start found other observations than the trace");
	again.forEach((entry, index) => {
		assertSame(recorded[index], entry);
	});
	return again;
}

/**
 * What a chosen step finds. A step that repeats a trace takes the recorded observation, or, when that has images, runs
 * the action again and must find the same.
 */
export async function observe(item: MenuItem, step: number, replay: Replay | undefined): Promise<Observation> {
	if (replay === undefined || step > replay.steps) return item.run();
	const recorded = recordedStep(replay, step, item.key);
	if (recorded.images.length === 0) return observationOf(recorded);
	const observation = await item.run();
	assertSame(recorded, { action: item.action, key: item.key, observation });
	return observation;
}

/** The recorded observation of `step`, which must belong to the option with `key`. */
function recordedStep(replay: Replay, step: number, key: string): ObservationEntry {
	const [recorded] = replay.observations.get(step) ?? [];
	if (recorded?.key !== key) {
		throw new ReplayError(`step ${String(step)} took ${key}; the trace took ${recorded?.key ?? "no step"}`);
	}
	return recorded;
}

function observationOf(entry: ObservationEntry): Observation {
	return { source: entry.source, text: entry.text, ...(entry.data === undefined ? {} : { data: entry.data }) };
}

/** Refuses an observation that differs from the recorded one in its step, source, text, image labels or data. */
function assertSame(recorded: ObservationEntry | undefined, { action, key, observation }: Entry): void {
	const facts = (source: string, text: string, images: readonly string[], data: unknown) =>
		JSON.stringify([source, text, images, data ?? null]);
	const found = facts(
		observation.source,
		observation.text,
		(observation.images ?? []).map((image) => image.label),
		observation.data,
	);
	if (
		recorded?.action !== action ||
		recorded.key !== key ||
		facts(recorded.source, recorded.text, recorded.images, recorded.data) !== found
	) {
		throw new ReplayError(`${key} found something other than what the trace recorded`);
	}
}

/**
 * A decider that repeats the choices of a recorded trace. With `then`, the replay stops after `steps` choices and
 * `then` decides from there on, and answers the questions. Without `then`, it also repeats the recorded answers.
 */
function replayDecider(entries: readonly TraceEntry[], fork?: Fork): Decider {
	const first = entries[0];
	if (first?.type !== "case") throw new ReplayError("a trace starts with its case entry");
	const recording = recordingOf(entries);
	if (fork === undefined) {
		const progress = { made: 0, limit: recording.choices.length };
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
	const stages = entries.filter((entry) => entry.type === "asked" || entry.type === "answers");
	return {
		menus: entries.filter((entry) => entry.type === "menu"),
		choices: entries.filter((entry) => entry.type === "choice"),
		answers: stages.length === 0 ? null : new Map(stages.flatMap((entry) => Object.entries(entry.answers))),
	};
}

export interface Fork {
	/** How many recorded choices to repeat before `then` decides. */
	readonly steps: number;
	readonly then: Decider;
}

type MenuEntry = Extract<TraceEntry, { type: "menu" }>;
type ChoiceEntry = Extract<TraceEntry, { type: "choice" }>;
interface Recording {
	readonly menus: readonly MenuEntry[];
	readonly choices: readonly ChoiceEntry[];
	/** Every recorded answer by question id, from every judging stage. */
	readonly answers: ReadonlyMap<string, Answer> | null;
}

const nextQuestion = (request: DecisionRequest): ChoiceQuestion | null => {
	const question = request.questions[0];
	return question?.kind === "choice" && question.id === "next" ? question : null;
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
			repeatChoice(next, recording.menus[progress.made - 1], recording.choices[progress.made - 1]),
		);
	}
	if (then !== undefined) return then.decide(request);
	return Promise.resolve(next === null ? repeatAnswers(request, recording.answers) : stopChoice(next));
}

function repeatChoice(
	question: ChoiceQuestion,
	menu: MenuEntry | undefined,
	choice: ChoiceEntry | undefined,
): DecisionResult {
	if (menu === undefined || choice === undefined) throw new ReplayError("the trace has fewer choices than the run");
	const text = menu.options.find((option) => option.key === choice.key)?.text;
	const label = Object.entries(question.choices).find(([, choiceText]) => choiceText === text)?.[0];
	if (label === undefined) throw new ReplayError(`the recorded choice ${choice.key} is not on the menu any more`);
	return {
		ok: true,
		answers: { [question.id]: { kind: "choice", choice: label, probabilities: { [label]: 1 } } },
		usage: NO_USAGE,
	};
}

function stopChoice(question: ChoiceQuestion): DecisionResult {
	return {
		ok: true,
		answers: { [question.id]: { kind: "choice", choice: STOP_KEY, probabilities: { [STOP_KEY]: 1 } } },
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

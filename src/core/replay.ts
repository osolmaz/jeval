import { STOP_KEY, type TraceEntry } from "./trace.ts";
import type { Answer, ChoiceQuestion, Decider, DecisionRequest, DecisionResult } from "./types.ts";

export class ReplayError extends Error {
	override readonly name = "ReplayError";
}

const NO_USAGE = { inputTokens: 0, milliseconds: 0 } as const;

/**
 * A decider that repeats the choices of a recorded trace. With `then`, the replay stops after `steps` choices and
 * `then` decides from there on, and answers the questions: a fork of the trace at that step. Without `then`, it also
 * repeats the recorded answers.
 */
export function replayDecider(entries: readonly TraceEntry[], fork?: Fork): Decider {
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

const recordingOf = (entries: readonly TraceEntry[]): Recording => ({
	menus: entries.filter((entry) => entry.type === "menu"),
	choices: entries.filter((entry) => entry.type === "choice"),
	answers: entries.find((entry) => entry.type === "answers"),
});

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
	readonly answers: Extract<TraceEntry, { type: "answers" }> | undefined;
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

function repeatAnswers(
	request: DecisionRequest,
	recorded: Extract<TraceEntry, { type: "answers" }> | undefined,
): DecisionResult {
	if (recorded === undefined) throw new ReplayError("the trace has no answers to repeat");
	const answers: Record<string, Answer> = {};
	for (const question of request.questions) {
		const known = recorded.answers[question.id];
		if (known === undefined) throw new ReplayError(`the trace has no answer for ${question.id}`);
		answers[question.id] = known;
	}
	return { ok: true, answers, usage: NO_USAGE };
}

import { definitionFor } from "./definition.ts";
import { pickKeys } from "./pick.ts";
import { type RecordedStep, recordedState, type Replay, ReplayError } from "./replay.ts";
import { Trace, type TraceEntry } from "./trace.ts";
import type {
	Answer,
	Answers,
	ChoiceAnswer,
	ChoiceQuestion,
	Decider,
	DecisionResult,
	Domain,
	Ending,
	JsonObject,
	Limits,
	Question,
	Questions,
	RunResult,
	StateMachine,
	View,
} from "./types.ts";

export interface RunOptions {
	readonly trace?: Trace;
	/**
	 * A trace to repeat: the run takes its recorded answers and states, under its limits, and asks the model only after
	 * them. It must be a trace of the same domain and case.
	 */
	readonly replay?: Replay;
	/** The case's id, for the trace. */
	readonly case?: string;
}

/** What every case of a domain shares, as the loop needs it: the domain's name and version, its limits and definition. */
export type DomainShared = Pick<Domain<JsonObject>, "name" | "version" | "limits" | "definition">;

/** One run of a case: what each part of the loop works with. */
interface Loop<S extends JsonObject> {
	readonly domain: DomainShared;
	readonly machine: StateMachine<S>;
	readonly decider: Decider;
	readonly limits: Limits;
	readonly trace: Trace;
	readonly replay: Replay | undefined;
}

/** How much smaller each retry's view is after the model reported that a request did not fit its window. */
const SHRINK = 0.7;
/** The most requests for one batch of questions: the first, and the retries with smaller views. */
const ATTEMPTS = 3;
/** The share of a request that the questions of one batch may take. */
const QUESTION_SHARE = 0.4;

/**
 * Runs one case's state machine: from the initial state, the model answers the questions of each state and the
 * transition gives the next state, until the domain asks nothing more.
 */
export async function run<S extends JsonObject>(
	domain: DomainShared,
	machine: StateMachine<S>,
	decider: Decider,
	options: RunOptions = {},
): Promise<RunResult<S>> {
	const { replay } = options;
	const limits = replay?.start.limits ?? domain.limits;
	const trace = options.trace ?? new Trace();
	const definition = definitionFor(domain).hash;
	const start = { domain: domain.name, version: domain.version, definition, case: options.case ?? null };
	trace.started({ ...start, model: decider.model, limits: { ...limits } });
	if (replay !== undefined) checkReplay(replay, start, trace);
	const loop: Loop<S> = { domain, machine, decider, limits, trace, replay };
	// A trace holds the states of the domain that wrote it, so a replay takes its states as the domain's own.
	const initial = replay === undefined ? await machine.initial() : (recordedState(replay, 0) as S);
	trace.state(0, initial);
	const { steps, ended, error, state } = await takeSteps(loop, initial);
	trace.ended(ended, steps, error);
	return { steps, ended, error, trace, state };
}

type Start = Pick<Extract<TraceEntry, { type: "start" }>, "domain" | "definition" | "case">;

/**
 * A replay repeats a trace of the same domain and case. A definition that changed since is noted: the repeated steps
 * keep what the model read then, and only what the model reads after them changes.
 */
function checkReplay(replay: Replay, start: Start, trace: Trace): void {
	const recorded = replay.start;
	if (recorded.domain !== start.domain) {
		throw new ReplayError(`the trace is of the domain ${recorded.domain}, not of ${start.domain}`);
	}
	if (recorded.case !== null && start.case !== null && recorded.case !== start.case) {
		throw new ReplayError(`the trace is of the case ${recorded.case}, not of ${start.case}`);
	}
	if (recorded.definition !== start.definition) {
		trace.note(`the trace's definition was ${recorded.definition}; this run's is ${start.definition}`);
	}
}

interface Ended<S> {
	readonly steps: number;
	readonly ended: Ending;
	readonly error: string | null;
	readonly state: S;
}

/** The answers of a step, and whether they were taken from a recorded trace; a string says why they failed. */
type Answered = { readonly answers: Answers; readonly repeated: boolean } | string;

async function takeSteps<S extends JsonObject>(loop: Loop<S>, initial: S): Promise<Ended<S>> {
	const { machine, limits, trace } = loop;
	let state = initial;
	for (let step = 1; ; step += 1) {
		const questions = machine.questions(state);
		if (Object.keys(questions).length === 0) {
			checkDone(loop.replay, step - 1);
			return { steps: step - 1, ended: "done", error: null, state };
		}
		if (limits.steps !== undefined && step > limits.steps) {
			return { steps: step - 1, ended: "step limit", error: null, state };
		}
		trace.questions(step, questions);
		const answered = await answersAt(loop, step, state, questions);
		if (typeof answered === "string") return { steps: step, ended: "failed", error: answered, state };
		trace.answered(step, answered.answers, answered.repeated);
		state = await nextState(loop, step, state, answered.answers);
		trace.state(step, state);
	}
}

/** While the run repeats a trace, the domain asks nothing only where the recorded run ended so, or after a fork. */
function checkDone(replay: Replay | undefined, steps: number): void {
	if (replay === undefined) return;
	const recorded =
		replay.ending === null
			? steps >= replay.steps.length
			: replay.ending.ended === "done" && steps === replay.ending.steps;
	if (!recorded) {
		throw new ReplayError(`the domain asks nothing after step ${String(steps)}, where the recorded run asked more`);
	}
}

/** The state after `step`: the recorded one while the run repeats a trace, or the transition's. */
function nextState<S extends JsonObject>(loop: Loop<S>, step: number, state: S, answers: Answers): Promise<S> {
	const { replay } = loop;
	if (replay !== undefined && step <= replay.steps.length) return Promise.resolve(recordedState(replay, step) as S);
	return loop.machine.transition(state, answers);
}

/**
 * The answers of `step`: the recorded ones while the run repeats a trace, then the model's. A replay of a whole trace
 * ends where the recorded run ended: there, only a failed request is left to repeat.
 */
function answersAt<S extends JsonObject>(
	loop: Loop<S>,
	step: number,
	state: S,
	questions: Questions,
): Promise<Answered> {
	const { replay } = loop;
	const recorded = replay?.steps[step - 1];
	if (recorded !== undefined) return Promise.resolve({ answers: fitted(recorded, questions, step), repeated: true });
	if (replay?.ending == null) return askModel(loop, state, questions);
	const { ended, steps, error } = replay.ending;
	if (ended !== "failed" || step !== steps) {
		throw new ReplayError(`the recorded run ended with ${ended} after ${String(steps)} steps, but this run goes on`);
	}
	loop.trace.note("the recorded request failed here");
	return Promise.resolve(error ?? "the recorded request failed");
}

/**
 * A recorded step's answers, fitted to the questions that the domain asks now. They must have the same ids and types,
 * and a choice answer must pick a choice that the question still has: by its key, for a pick, whose texts and labels
 * may have changed since, or else by its label and its text.
 */
function fitted(recorded: RecordedStep, questions: Questions, step: number): Answers {
	const ids = Object.keys(questions);
	const answered = Object.keys(recorded.answers);
	if (ids.length !== answered.length || ids.some((id) => !Object.hasOwn(recorded.answers, id))) {
		throw new ReplayError(
			`step ${String(step)} asks ${ids.join(", ")}, but the trace answered ${answered.join(", ")}`,
		);
	}
	return Object.fromEntries(
		Object.entries(questions).flatMap(([id, question]) => {
			const answer = recorded.answers[id];
			return answer === undefined ? [] : [[id, fitAnswer(id, question, recorded.questions[id], answer)] as const];
		}),
	);
}

function fitAnswer(id: string, question: Question, before: Question | undefined, answer: Answer): Answer {
	if (answer.type !== question.type) {
		throw new ReplayError(`the trace has a ${answer.type} answer to ${id}, which is a ${question.type} question now`);
	}
	return answer.type === "choice" && question.type === "choice" ? fitChoice(id, question, before, answer) : answer;
}

/** A recorded choice answer, under the labels that the domain's question has now. */
function fitChoice(
	id: string,
	question: ChoiceQuestion,
	before: Question | undefined,
	answer: ChoiceAnswer,
): ChoiceAnswer {
	const was = pickKeys(before);
	const now = pickKeys(question);
	if (was !== null && now !== null) return relabeled(id, answer, was, now);
	const text = before?.type === "choice" ? before.criteria[answer.choice] : undefined;
	if (text === undefined || question.criteria[answer.choice] !== text) {
		throw new ReplayError(
			`the recorded answer to ${id}, "${text ?? answer.choice}", is not among its choices any more`,
		);
	}
	return answer;
}

/** A recorded pick, found by its choices' keys among the labels of the pick now; a choice that is gone loses its probability. */
function relabeled(
	id: string,
	answer: ChoiceAnswer,
	was: ReadonlyMap<string, string>,
	now: ReadonlyMap<string, string>,
): ChoiceAnswer {
	const labelOf = new Map([...now].map(([label, key]) => [key, label]));
	const label = (old: string) => labelOf.get(was.get(old) ?? "");
	const choice = label(answer.choice);
	if (choice === undefined) {
		const key = was.get(answer.choice) ?? answer.choice;
		throw new ReplayError(`the recorded answer to ${id}, ${key}, is not among its choices any more`);
	}
	const probabilities = Object.entries(answer.probabilities).flatMap(([old, p]) => {
		const to = label(old);
		return to === undefined ? [] : [[to, p] as const];
	});
	return { ...answer, choice, probabilities: Object.fromEntries(probabilities) };
}

/** Why a request gave no answers, for the run's error. */
const failureOf = (result: DecisionResult): string =>
	result.stopReason === "stop" ? "the model gave no answer" : (result.errorMessage ?? result.stopReason);

/** The question as the model reads it: without switch's own facts. */
function sendable(question: Question): Question {
	const { data, ...sent } = question;
	return data === undefined ? question : sent;
}

/** The model's answers to `questions`, in batches that fit the window; a string says why they failed. */
async function askModel<S extends JsonObject>(loop: Loop<S>, state: S, questions: Questions): Promise<Answered> {
	const { decider, limits } = loop;
	const room = Math.floor(decider.window * limits.windowShare * QUESTION_SHARE);
	const sent = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, sendable(question)]));
	const answers: Record<string, Answer> = {};
	for (const batch of batches(sent, room, decider.charsPerToken)) {
		const result = await ask(loop, state, batch);
		if (result.stopReason !== "stop") return failureOf(result);
		Object.assign(answers, result.decisionAnswers);
	}
	const misfit = Object.entries(questions)
		.map(([id, question]) => misfitOf(id, question, answers[id]))
		.find((reason) => reason !== null);
	if (misfit !== undefined) return misfit;
	// Only the answers to the step's questions, in the order of its questions.
	const ordered = Object.keys(questions).flatMap((id) => {
		const answer = answers[id];
		return answer === undefined ? [] : [[id, answer] as const];
	});
	return { answers: Object.fromEntries(ordered), repeated: false };
}

/** Why an answer does not fit its question: missing, of another type, or a choice that is none of the labels. */
function misfitOf(id: string, question: Question, answer: Answer | undefined): string | null {
	if (answer === undefined) return `no answer to ${id}`;
	if (answer.type !== question.type)
		return `the answer to ${id} is a ${answer.type} answer, not a ${question.type} one`;
	if (answer.type === "choice" && question.type === "choice" && !Object.hasOwn(question.criteria, answer.choice)) {
		return `the model answered ${answer.choice} to ${id}, which is none of its labels`;
	}
	return null;
}

/** Questions in groups whose estimated size stays under `room` tokens; a single larger question gets its own group. */
export function batches(questions: Questions, room: number, charsPerToken: number): Questions[] {
	const groups: Record<string, Question>[] = [];
	let size = 0;
	for (const [id, question] of Object.entries(questions)) {
		const tokens = estimateTokens({ [id]: question }, charsPerToken);
		const current = groups.at(-1);
		if (current === undefined || size + tokens > room) {
			groups.push({ [id]: question });
			size = tokens;
		} else {
			current[id] = question;
			size += tokens;
		}
	}
	return groups;
}

/** The view of a state: the domain's, or the state as it is. */
function viewOf<S extends JsonObject>(
	machine: StateMachine<S>,
	state: S,
	tokens: number,
	charsPerToken: number,
): Promise<View> {
	if (machine.view === undefined) return Promise.resolve({ decisionState: state });
	return machine.view(state, tokens, charsPerToken);
}

/** The view as the request takes it: its state, and its images when it has any, without anything else it holds. */
const requestOf = ({ decisionState, decisionImages }: View): View =>
	decisionImages === undefined ? { decisionState } : { decisionState, decisionImages };

/**
 * Sends one decision request: the view and `questions`. When the model reports that the request did not fit its
 * window, it asks the view function for a smaller view and sends it again, up to `ATTEMPTS` requests in all. Without a
 * view function, the view cannot shrink, so the request is sent once.
 */
async function ask<S extends JsonObject>(loop: Loop<S>, state: S, questions: Questions): Promise<DecisionResult> {
	const { machine, decider, limits, trace } = loop;
	const budget = Math.floor(decider.window * limits.windowShare);
	const attempts = machine.view === undefined ? 1 : ATTEMPTS;
	let room = budget - estimateTokens(questions, decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = await viewOf(machine, state, room, decider.charsPerToken);
		const result = await decider.decide({ ...requestOf(view), decisionQuestions: questions });
		if (!result.tooLong || attempt === attempts) return result;
		room = Math.floor(room * SHRINK);
		trace.note(`the request did not fit the model's window; trying a view of ${String(room)} tokens`);
	}
}

/** The estimated size of `value` as JSON, in tokens of `charsPerToken` characters. */
export function estimateTokens(value: unknown, charsPerToken: number): number {
	return Math.ceil(JSON.stringify(value).length / charsPerToken);
}

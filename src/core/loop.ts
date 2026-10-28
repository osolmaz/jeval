import { offerChoices } from "./choices.ts";
import { recordedPick, recordedState, type Replay, ReplayError } from "./replay.ts";
import { STOP_KEY, Trace } from "./trace.ts";
import type {
	Answer,
	Answers,
	Ask,
	Choice,
	ChoiceQuestion,
	Decider,
	DecisionResult,
	Domain,
	Ending,
	JsonObject,
	Limits,
	Purpose,
	Question,
	Questions,
	RunResult,
	StageView,
	StateMachine,
	View,
} from "./types.ts";

export interface RunOptions {
	/** Limits in place of the domain's own, such as those of a trace that the run repeats. */
	readonly limits?: Limits;
	readonly trace?: Trace;
	/** A trace to repeat: the run takes its recorded picks and states, and asks the model only after them. */
	readonly replay?: Replay;
}

/**
 * What every case of a domain shares, as the loop needs it: the domain's name and version, the two texts of the pick
 * question, and the limits.
 */
export type DomainShared = Pick<Domain<JsonObject>, "name" | "version" | "stop" | "instructions" | "limits">;

/** The id of the pick question, which the domain's own questions cannot use. */
export const PICK_ID = "pick";

/** One run of a case: what each part of the loop works with. */
interface Loop<S extends JsonObject, C extends Choice> {
	readonly domain: DomainShared;
	readonly machine: StateMachine<S, C>;
	readonly decider: Decider;
	readonly limits: Limits;
	readonly trace: Trace;
	readonly replay: Replay | undefined;
}

/** How much smaller each retry's view is after the model reported that a request did not fit its window. */
const SHRINK = 0.7;
/** The most requests for one pick or one batch of questions: the first, and the retries with smaller views. */
const ATTEMPTS = 3;
/** The share of a request that the questions of one answer batch may take. */
const QUESTION_SHARE = 0.4;

/**
 * Runs one case's state machine: from the initial state, the model picks from the choices and the transition gives the
 * next state, until the model picks stop; then the model answers the questions over the last state.
 */
export async function run<S extends JsonObject, C extends Choice>(
	domain: DomainShared,
	machine: StateMachine<S, C>,
	decider: Decider,
	options: RunOptions = {},
): Promise<RunResult<S>> {
	const limits = options.limits ?? domain.limits;
	const trace = options.trace ?? new Trace();
	const { replay } = options;
	trace.started({ domain: domain.name, version: domain.version, model: decider.model, limits });
	const loop: Loop<S, C> = { domain, machine, decider, limits, trace, replay };
	// A trace holds the states of the domain that wrote it, so a replay takes its states as the domain's own.
	const initial = replay === undefined ? await machine.initial() : (recordedState(replay, 0) as S);
	trace.state(0, initial);
	const { steps, ended, state } = await takeSteps(loop, initial);
	const outcome = await answer(loop, state);
	trace.ended(ended, outcome.error);
	return { answers: outcome.answers, steps, ended, error: outcome.error, trace, state };
}

async function takeSteps<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	initial: S,
): Promise<{ steps: number; ended: Ending; state: S }> {
	const { machine, limits, trace } = loop;
	const picked = new Set<string>();
	let state = initial;
	let step = 0;
	while (step < limits.steps) {
		const offered = offerChoices(machine.choices(state), picked, limits.choices - 1, loop.domain.stop);
		if (offered.length === 0) return { steps: step, ended: "no choices", state };
		step += 1;
		trace.choices(step, offered, loop.domain.stop);
		const pick = await pickAt(loop, step, state, offered);
		if (pick === null) return { steps: step, ended: "pick failed", state };
		trace.picked(step, pick.entry);
		if (pick.choice === null) return { steps: step, ended: "stop", state };
		picked.add(pick.entry.choice);
		state = await nextState(loop, step, state, pick.choice);
		trace.state(step, state);
	}
	return { steps: step, ended: "step limit", state };
}

/** The state after `step`: the recorded one while the run repeats a trace, or the transition's. */
function nextState<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	step: number,
	state: S,
	choice: C,
): Promise<S> {
	const { replay } = loop;
	if (replay !== undefined && step <= replay.steps) return Promise.resolve(recordedState(replay, step) as S);
	return loop.machine.transition(state, choice);
}

/** A pick: the picked choice, or null for stop, and its trace entry. */
interface Picked<C extends Choice> {
	readonly choice: C | null;
	readonly entry: {
		/** The picked choice's key, or stop. */
		readonly choice: string;
		readonly probabilities: Readonly<Record<string, number>>;
		readonly confidence: number;
		readonly repeated?: true;
	};
}

/**
 * The pick at `step`: the recorded one while the run repeats a trace, then the model's. A replay of every step ends
 * where the recorded steps ended: there, only a failed pick is left to repeat.
 */
function pickAt<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	step: number,
	state: S,
	offered: readonly C[],
): Promise<Picked<C> | null> {
	const { replay } = loop;
	if (replay === undefined || replay.ending === null) {
		if (replay !== undefined && step <= replay.steps) return Promise.resolve(repeatPick(replay, step, offered));
		return choose(loop, state, offered);
	}
	if (step <= replay.steps) return Promise.resolve(repeatPick(replay, step, offered));
	if (replay.ending !== "pick failed") {
		const after = `${String(replay.steps)} steps`;
		throw new ReplayError(`the recorded run ended with ${replay.ending} after ${after}, but this run goes on`);
	}
	loop.trace.note("the recorded pick failed here");
	return Promise.resolve(null);
}

/** The recorded pick of `step`, found among the offered choices by its key. */
function repeatPick<C extends Choice>(replay: Replay, step: number, offered: readonly C[]): Picked<C> {
	const recorded = recordedPick(replay, step);
	const choice = recorded.choice === STOP_KEY ? null : offered.find((offer) => offer.key === recorded.choice);
	if (choice === undefined) {
		throw new ReplayError(`the recorded pick ${recorded.choice} is not among the choices any more`);
	}
	const { probabilities, confidence } = recorded;
	return { choice, entry: { choice: recorded.choice, probabilities, confidence, repeated: true } };
}

/** The model's pick from the offered choices and stop, which it sees under short labels; null when the pick failed. */
async function choose<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	offered: readonly C[],
): Promise<Picked<C> | null> {
	const { domain, trace } = loop;
	const labels = offered.map((_, index) => `o${String(index + 1)}`);
	const criteria: Record<string, string> = Object.fromEntries(
		offered.map((choice, index) => [labels[index] ?? choice.key, choice.text]),
	);
	criteria[STOP_KEY] = domain.stop;
	const question: ChoiceQuestion = { type: "choice", instructions: domain.instructions, criteria };
	const result = await ask(loop, state, { [PICK_ID]: question }, "pick");
	const answered = result.decisionAnswers[PICK_ID];
	if (result.stopReason !== "stop" || answered?.type !== "choice") {
		trace.note(`the pick failed: ${failureOf(result)}; the case goes on to its answers`);
		return null;
	}
	if (!(answered.choice in criteria)) {
		trace.note(`the pick failed: the model picked ${answered.choice}, which is none of the labels`);
		return null;
	}
	// The labels are the model's names for the choices; the trace keeps the choices' own keys.
	const keyOf = (label: string) => offered[labels.indexOf(label)]?.key ?? label;
	const probabilities = Object.fromEntries(
		Object.entries(answered.probabilities).map(([label, p]) => [keyOf(label), p]),
	);
	const choice = offered[labels.indexOf(answered.choice)] ?? null;
	return { choice, entry: { choice: keyOf(answered.choice), probabilities, confidence: answered.confidence } };
}

/** Why a request gave no answers, for a note or an error. */
const failureOf = (result: DecisionResult): string =>
	result.stopReason === "stop" ? "the model gave no answer" : (result.errorMessage ?? result.stopReason);

/** An answer stage failed: the model's window was exceeded, the provider failed, or a question got no answer. */
export class AskError extends Error {
	override readonly name = "AskError";
}

async function answer<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
): Promise<{ answers: Answers | null; error: string | null }> {
	const { machine, trace } = loop;
	const questions = machine.questions?.() ?? {};
	if (Object.hasOwn(questions, PICK_ID)) {
		throw new Error(`a question cannot have the id ${PICK_ID}, which the pick question has`);
	}
	try {
		const answers =
			machine.answer === undefined
				? await asker(loop, state, false)(questions, { stage: "answers" })
				: await machine.answer({ state, questions, ask: asker(loop, state, true) });
		const final = completed(questions, answers);
		trace.answered(final);
		return { answers: final, error: null };
	} catch (error: unknown) {
		if (error instanceof AskError) return { answers: null, error: error.message };
		throw error;
	}
}

/** Every question's answer, in the order of the questions. */
function completed(questions: Questions, answers: Answers): Answers {
	const final: Record<string, Answer> = {};
	for (const id of Object.keys(questions)) {
		const found = answers[id];
		if (found === undefined) throw new AskError(`no answer for ${id}`);
		final[id] = found;
	}
	return final;
}

/**
 * The `ask` of the answers: the model's answers in batches that fit the window, or, while the run repeats a whole
 * trace, the recorded answers. A domain's own answer stages are each traced; the core's single round of questions is
 * traced only as the final answers.
 */
function asker<S extends JsonObject, C extends Choice>(loop: Loop<S, C>, state: S, staged: boolean): Ask {
	const { replay, trace } = loop;
	return async (questions, options) => {
		const answers =
			replay?.answers == null
				? await askModel(loop, state, questions, options.view)
				: repeatAnswers(replay, questions);
		if (staged) trace.stage(options.stage, answers);
		return answers;
	};
}

async function askModel<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	questions: Questions,
	view: StageView | undefined,
): Promise<Answers> {
	const { decider, limits } = loop;
	const room = Math.floor(decider.window * limits.windowShare * QUESTION_SHARE);
	const answers: Record<string, Answer> = {};
	for (const batch of batches(questions, room, decider.charsPerToken)) {
		const result = await ask(loop, state, batch, "answer", view);
		if (result.stopReason !== "stop") throw new AskError(failureOf(result));
		Object.assign(answers, result.decisionAnswers);
	}
	const missing = Object.keys(questions).filter((id) => answers[id] === undefined);
	if (missing.length > 0) throw new AskError(`no answer for ${missing.join(", ")}`);
	return answers;
}

/** The recorded answers to `questions`; a question that the recording has no answer for fails as the recording did. */
function repeatAnswers(replay: Replay, questions: Questions): Answers {
	const answers: Record<string, Answer> = {};
	for (const id of Object.keys(questions)) {
		const recorded = replay.answers?.[id];
		if (recorded !== undefined) answers[id] = recorded;
		else if (replay.answersError !== null) throw new AskError(replay.answersError);
		else throw new ReplayError(`the trace has no answer for ${id}`);
	}
	return answers;
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

/** The view of a state: the stage's own, the domain's, or the state as it is. */
function viewOf<S extends JsonObject>(
	machine: StateMachine<S>,
	state: S,
	purpose: Purpose,
	tokens: number,
	charsPerToken: number,
	stage: StageView | undefined,
): Promise<View> {
	if (stage !== undefined) return stage(tokens, charsPerToken);
	if (machine.view === undefined) return Promise.resolve({ decisionState: state, decisionImages: [] });
	return machine.view(state, purpose, tokens, charsPerToken);
}

/**
 * Sends one decision request: the view and `questions`. When the model reports that the request did not fit its
 * window, it asks for a smaller view and sends it again, up to `ATTEMPTS` requests in all.
 */
async function ask<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	questions: Questions,
	purpose: Purpose,
	stage?: StageView,
): Promise<DecisionResult> {
	const { machine, decider, limits, trace } = loop;
	const budget = Math.floor(decider.window * limits.windowShare);
	let room = budget - estimateTokens(questions, decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = await viewOf(machine, state, purpose, room, decider.charsPerToken, stage);
		const { decisionState, decisionImages } = view;
		const result = await decider.decide({ decisionState, decisionImages, decisionQuestions: questions });
		if (!result.tooLong || attempt === ATTEMPTS) return result;
		room = Math.floor(room * SHRINK);
		trace.note(`the request did not fit the model's window; trying a view of ${String(room)} tokens`);
	}
}

/** The estimated size of `value` as JSON, in tokens of `charsPerToken` characters. */
export function estimateTokens(value: unknown, charsPerToken: number): number {
	return Math.ceil(JSON.stringify(value).length / charsPerToken);
}

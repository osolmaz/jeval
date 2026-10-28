import { offerChoices } from "./choices.ts";
import { recordedState, type Replay } from "./replay.ts";
import { STOP_KEY, Trace } from "./trace.ts";
import type {
	Answer,
	Ask,
	Choice,
	ChoiceQuestion,
	Decider,
	DecisionRequest,
	DecisionResult,
	Domain,
	Ending,
	JsonObject,
	Limits,
	Question,
	RunResult,
	StateMachine,
	Usage,
	View,
} from "./types.ts";
import { DEFAULT_LIMITS } from "./types.ts";

export interface RunOptions {
	readonly limits?: Limits;
	readonly trace?: Trace;
	/** A trace to repeat: the run takes its recorded states and runs no transition, up to a fork. */
	readonly replay?: Replay;
}

/** What the loop needs of a domain: its name and version, and the two texts of the pick question. */
export type DomainTexts = Pick<Domain<JsonObject>, "name" | "version" | "stop" | "instructions">;

/** One run of a case: what each part of the loop works with. */
interface Loop<S extends JsonObject, C extends Choice> {
	readonly domain: DomainTexts;
	readonly machine: StateMachine<S, C>;
	readonly decider: Decider;
	readonly limits: Limits;
	readonly trace: Trace;
}

/** How much smaller each retry's view is after the model reported that a request did not fit its window. */
const SHRINK = 0.7;
const ATTEMPTS = 3;
/** The share of a request that the questions of one answer batch may take. */
const QUESTION_SHARE = 0.4;

/**
 * Runs one case's state machine: from the initial state, the model picks from the choices and the transition gives the
 * next state, until the model picks stop; then the model answers the questions over the last state.
 */
export async function run<S extends JsonObject, C extends Choice>(
	domain: DomainTexts,
	machine: StateMachine<S, C>,
	decider: Decider,
	options: RunOptions = {},
): Promise<RunResult<S>> {
	const limits = options.limits ?? DEFAULT_LIMITS;
	const trace = options.trace ?? new Trace();
	trace.started({ domain: domain.name, version: domain.version, model: decider.model, limits });
	const loop: Loop<S, C> = { domain, machine, decider, limits, trace };
	// A trace holds the states of the domain that wrote it, so a replay takes its states as the domain's own.
	const initial = options.replay === undefined ? await machine.initial() : (recordedState(options.replay, 0) as S);
	trace.state(0, initial);
	const { steps, ended, state } = await takeSteps(loop, initial, options.replay);
	const outcome = await answer(loop, state);
	return { answers: outcome.answers, steps, ended, error: outcome.error, trace, state };
}

async function takeSteps<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	initial: S,
	replay: Replay | undefined,
): Promise<{ steps: number; ended: Ending; state: S }> {
	const { machine, limits, trace } = loop;
	const picked = new Set<string>();
	let state = initial;
	let step = 0;
	while (step < limits.steps) {
		const offered = offerChoices(machine.choices(state), picked, limits.choices - 1);
		if (offered.length === 0) return { steps: step, ended: "no choices", state };
		step += 1;
		trace.choices(step, offered, loop.domain.stop);
		const pick = await choose(loop, state, offered);
		if (pick === null) return { steps: step, ended: "pick failed", state };
		trace.picked(step, pick);
		if (pick.choice === null) return { steps: step, ended: "stop", state };
		picked.add(pick.key);
		state =
			replay !== undefined && step <= replay.steps
				? (recordedState(replay, step) as S)
				: await machine.transition(state, pick.choice);
		trace.state(step, state);
	}
	return { steps: step, ended: "step limit", state };
}
/** The model's pick from the choices: the choice, or null for stop, its key, and the probabilities by key. */
interface Picked<C extends Choice> {
	readonly choice: C | null;
	readonly key: string;
	readonly probabilities: Readonly<Record<string, number>>;
	readonly confidence: number | undefined;
	readonly usage: Usage;
}

async function choose<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	offered: readonly C[],
): Promise<Picked<C> | null> {
	const { domain, trace } = loop;
	const labels = offered.map((_, index) => `o${String(index + 1)}`);
	const choices: Record<string, string> = {};
	offered.forEach((choice, index) => {
		choices[labels[index] ?? choice.key] = choice.text;
	});
	choices[STOP_KEY] = domain.stop;
	const question: ChoiceQuestion = { type: "choice", id: "next", instructions: domain.instructions, choices };
	const result = await ask(loop, state, [question], undefined, "choose");
	if (!result.ok) {
		trace.note(`the pick failed (${result.failure}): ${result.message}; the case goes on to its answers`);
		return null;
	}
	const answered = result.answers[question.id];
	if (answered?.type !== "choice") {
		trace.note("the model gave no pick; the case goes on to its answers");
		return null;
	}
	// The stop label is not a choice's label, so it maps to no choice and keeps its own name as the key.
	const keyOf = (label: string) => offered[labels.indexOf(label)]?.key ?? label;
	const probabilities = Object.fromEntries(
		Object.entries(answered.probabilities).map(([label, p]) => [keyOf(label), p]),
	);
	return {
		choice: offered[labels.indexOf(answered.choice)] ?? null,
		key: keyOf(answered.choice),
		probabilities,
		confidence: answered.confidence,
		usage: result.usage,
	};
}

/** An answer stage failed: the model's window was exceeded, the provider failed, or a question got no answer. */
export class AskError extends Error {
	override readonly name = "AskError";
}

async function answer<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
): Promise<{ answers: Record<string, Answer> | null; error: string | null }> {
	const { machine, trace } = loop;
	const questions = machine.questions?.() ?? [];
	const usages: Usage[] = [];
	try {
		const answers =
			machine.answer === undefined
				? await asker(loop, state, usages, false)(questions, { stage: "answers" })
				: await machine.answer({ state, questions, ask: asker(loop, state, usages, true) });
		const final: Record<string, Answer> = {};
		for (const question of questions) {
			const found = answers[question.id];
			if (found === undefined) throw new AskError(`no answer for ${question.id}`);
			final[question.id] = found;
		}
		trace.answered(final, usages);
		return { answers: final, error: null };
	} catch (error: unknown) {
		if (error instanceof AskError) return { answers: null, error: error.message };
		throw error;
	}
}

/**
 * The `ask` of the answers: batches that fit the window, over the view or over a stage's own JSON. A domain's own
 * answer stages are each traced; the core's single round of questions is traced only as the final answers.
 */
function asker<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	usages: Usage[],
	staged: boolean,
): Ask {
	const { decider, limits, trace } = loop;
	const room = Math.floor(decider.window * limits.windowShare * QUESTION_SHARE);
	return async (questions, options) => {
		const answers: Record<string, Answer> = {};
		const used: Usage[] = [];
		for (const batch of batches(questions, room, decider.charsPerToken)) {
			const result =
				options.json === undefined
					? await ask(loop, state, batch, options.extra)
					: await decider.decide({ json: options.json, images: [], questions: batch });
			used.push(result.usage);
			if (!result.ok) throw new AskError(`${result.failure}: ${result.message}`);
			Object.assign(answers, result.answers);
		}
		const missing = questions.filter((question) => answers[question.id] === undefined).map((question) => question.id);
		if (missing.length > 0) throw new AskError(`no answer for ${missing.join(", ")}`);
		usages.push(...used);
		if (staged) trace.stage(options.stage, answers, used);
		return answers;
	};
}

/** Questions in groups whose estimated size stays under `room` tokens; a single larger question gets its own group. */
export function batches(questions: readonly Question[], room: number, charsPerToken: number): Question[][] {
	const groups: Question[][] = [];
	let size = 0;
	for (const question of questions) {
		const tokens = estimateTokens(question, charsPerToken);
		const current = groups.at(-1);
		if (current === undefined || size + tokens > room) {
			groups.push([question]);
			size = tokens;
		} else {
			current.push(question);
			size += tokens;
		}
	}
	return groups;
}

/** The view of a state: the domain's, or the state as it is. */
function viewOf<S extends JsonObject>(
	machine: StateMachine<S>,
	state: S,
	purpose: "choose" | "answer",
	tokens: number,
): Promise<View> {
	if (machine.view === undefined) return Promise.resolve({ json: state, images: [], omitted: [] });
	return machine.view(state, purpose, tokens);
}

/** Sends one request; when the model reports that it did not fit its window, sends a smaller view, up to three times. */
async function ask<S extends JsonObject, C extends Choice>(
	loop: Loop<S, C>,
	state: S,
	questions: readonly Question[],
	extra: JsonObject | undefined,
	purpose: "choose" | "answer" = "answer",
): Promise<DecisionResult> {
	const { machine, decider, limits, trace } = loop;
	const budget = Math.floor(decider.window * limits.windowShare);
	let room = budget - estimateTokens(extra === undefined ? questions : [questions, extra], decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = await viewOf(machine, state, purpose, room);
		noteOmissions(view, trace);
		const result = await decider.decide(request(view, questions, extra));
		if (result.ok || result.failure !== "window" || attempt === ATTEMPTS) return result;
		room = Math.floor(room * SHRINK);
		trace.note(`the request did not fit the model's window; trying a view of ${String(room)} tokens`);
	}
}

function request(view: View, questions: readonly Question[], extra: JsonObject | undefined): DecisionRequest {
	return { json: extra === undefined ? view.json : { ...view.json, ...extra }, images: view.images, questions };
}

function noteOmissions(view: View, trace: Trace): void {
	if (view.omitted.length > 0) trace.note(`the view left out: ${view.omitted.join("; ")}`);
}

export function estimateTokens(value: unknown, charsPerToken: number): number {
	return Math.ceil(JSON.stringify(value).length / charsPerToken);
}

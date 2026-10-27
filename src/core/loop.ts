import { buildMenu } from "./menu.ts";
import { observe, type Replay, startOf } from "./replay.ts";
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
	JsonObject,
	Limits,
	Question,
	Step,
	Usage,
	View,
} from "./types.ts";
import { DEFAULT_LIMITS } from "./types.ts";

export interface RunOptions {
	readonly case: string;
	readonly limits?: Limits;
	readonly trace?: Trace;
	/** A trace to repeat: the run takes its recorded observations and runs no choice again, up to a fork. */
	readonly replay?: Replay;
}

/**
 * Why the steps ended: the model chose stop, the menu was empty, the run took as many steps as its limits allow, or the
 * pick failed.
 */
export type Ending = "stop" | "empty menu" | "step limit" | "no choice";

export interface RunResult {
	/** Every question's answer, or null when the answers could not be obtained. */
	readonly answers: Readonly<Record<string, Answer>> | null;
	readonly steps: number;
	readonly ended: Ending;
	readonly error: string | null;
	readonly trace: Trace;
	/** Every step of the case, the start's included, in order. */
	readonly history: readonly Step[];
}

/** One run of a domain on one case: what each part of the loop works with. */
interface Loop<W> {
	readonly domain: Domain<W>;
	readonly world: W;
	readonly history: Step[];
	readonly decider: Decider;
	readonly limits: Limits;
	readonly trace: Trace;
}

/** How much smaller each retry's view is after the model reported that a request did not fit its window. */
const SHRINK = 0.7;
const ATTEMPTS = 3;
/** The share of a request that the questions of one answer batch may take. */
const QUESTION_SHARE = 0.4;

/** Runs a domain on one case: the model picks from the menu until it stops, then answers the questions. */
export async function run<W>(domain: Domain<W>, world: W, decider: Decider, options: RunOptions): Promise<RunResult> {
	const limits = options.limits ?? DEFAULT_LIMITS;
	const trace = options.trace ?? new Trace();
	trace.caseStarted({
		case: options.case,
		domain: domain.name,
		version: domain.version,
		model: decider.model,
		limits,
	});
	const loop: Loop<W> = { domain, world, history: [], decider, limits, trace };
	for (const opening of await startOf(domain, world, options.replay)) {
		loop.history.push(opening);
		trace.observed(0, opening.kind, opening.key, opening.observation);
	}
	const { steps, ended } = await takeSteps(loop, options.replay);
	const outcome = await answer(loop, domain.questions(world));
	return { answers: outcome.answers, steps, ended, error: outcome.error, trace, history: loop.history };
}

async function takeSteps<W>(loop: Loop<W>, replay: Replay | undefined): Promise<{ steps: number; ended: Ending }> {
	const { domain, world, history, limits, trace } = loop;
	let step = 0;
	while (step < limits.steps) {
		const menu = buildMenu(domain.menu, world, history, limits.choices - 1);
		if (menu.length === 0) return { steps: step, ended: "empty menu" };
		step += 1;
		trace.menu(step, menu, domain.stop);
		const chosen = await choose(loop, menu);
		if (chosen === null) return { steps: step, ended: "no choice" };
		trace.chose(step, chosen);
		if (chosen.choice === null) return { steps: step, ended: "stop" };
		const observation = await observe(chosen.choice, step, replay);
		history.push({ kind: chosen.choice.kind, key: chosen.choice.key, observation });
		trace.observed(step, chosen.choice.kind, chosen.choice.key, observation);
	}
	return { steps: step, ended: "step limit" };
}

/** The model's choice from a menu: the choice, or null for stop, its key, and the probabilities by key. */
interface Chosen {
	readonly choice: Choice | null;
	readonly key: string;
	readonly probabilities: Readonly<Record<string, number>>;
	readonly confidence: number | undefined;
	readonly usage: Usage;
}

async function choose<W>(loop: Loop<W>, menu: readonly Choice[]): Promise<Chosen | null> {
	const { domain, trace } = loop;
	const labels = menu.map((_, index) => `o${String(index + 1)}`);
	const choices: Record<string, string> = {};
	menu.forEach((choice, index) => {
		choices[labels[index] ?? choice.key] = choice.text;
	});
	choices[STOP_KEY] = domain.stop;
	const question: ChoiceQuestion = { type: "choice", id: "next", instructions: domain.instructions, choices };
	const result = await ask(loop, [question], undefined, "choose");
	if (!result.ok) {
		trace.note(`the choice failed (${result.failure}): ${result.message}; the case goes on to its answers`);
		return null;
	}
	const answered = result.answers[question.id];
	if (answered?.type !== "choice") {
		trace.note("the model gave no choice; the case goes on to its answers");
		return null;
	}
	// The stop label is not a choice's label, so it maps to no choice and keeps its own name as the key.
	const keyOf = (label: string) => menu[labels.indexOf(label)]?.key ?? label;
	const probabilities = Object.fromEntries(
		Object.entries(answered.probabilities).map(([label, p]) => [keyOf(label), p]),
	);
	return {
		choice: menu[labels.indexOf(answered.choice)] ?? null,
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

async function answer<W>(
	loop: Loop<W>,
	questions: readonly Question[],
): Promise<{ answers: Record<string, Answer> | null; error: string | null }> {
	const { domain, world, history, trace } = loop;
	const usages: Usage[] = [];
	const ask = asker(loop, usages);
	try {
		const answers =
			domain.answer === undefined
				? await ask(questions, { stage: "answers" })
				: await domain.answer({ world, history, questions, ask });
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

/** The `ask` that answer stages get: batches that fit the window, over the view or a fixed state, each stage traced. */
function asker<W>(loop: Loop<W>, usages: Usage[]): Ask {
	const { decider, limits, trace } = loop;
	const room = Math.floor(decider.window * limits.windowShare * QUESTION_SHARE);
	return async (questions, options) => {
		const answers: Record<string, Answer> = {};
		const used: Usage[] = [];
		for (const batch of batches(questions, room, decider.charsPerToken)) {
			const result =
				options.state === undefined
					? await ask(loop, batch, options.extra)
					: await decider.decide({ state: options.state, images: [], questions: batch });
			used.push(result.usage);
			if (!result.ok) throw new AskError(`${result.failure}: ${result.message}`);
			Object.assign(answers, result.answers);
		}
		const missing = questions.filter((question) => answers[question.id] === undefined).map((question) => question.id);
		if (missing.length > 0) throw new AskError(`no answer for ${missing.join(", ")}`);
		usages.push(...used);
		trace.asked(options.stage, answers, used);
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

/** Sends one request; when the model reports that it did not fit its window, sends a smaller view, up to three times. */
async function ask<W>(
	loop: Loop<W>,
	questions: readonly Question[],
	extra: JsonObject | undefined,
	purpose: "choose" | "answer" = "answer",
): Promise<DecisionResult> {
	const { domain, world, history, decider, limits, trace } = loop;
	const budget = Math.floor(decider.window * limits.windowShare);
	let room = budget - estimateTokens(extra === undefined ? questions : [questions, extra], decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = domain.view(world, history, purpose, room);
		noteOmissions(view, trace);
		const result = await decider.decide(request(view, questions, extra));
		if (result.ok || result.failure !== "window" || attempt === ATTEMPTS) return result;
		room = Math.floor(room * SHRINK);
		trace.note(`the request did not fit the model's window; trying a view of ${String(room)} tokens`);
	}
}

function request(view: View, questions: readonly Question[], extra: JsonObject | undefined): DecisionRequest {
	return { state: extra === undefined ? view.state : { ...view.state, ...extra }, images: view.images, questions };
}

function noteOmissions(view: View, trace: Trace): void {
	if (view.omitted.length > 0) trace.note(`the view left out: ${view.omitted.join("; ")}`);
}

export function estimateTokens(value: unknown, charsPerToken: number): number {
	return Math.ceil(JSON.stringify(value).length / charsPerToken);
}

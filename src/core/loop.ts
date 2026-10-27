import { buildMenu } from "./menu.ts";
import { observe, type Replay, startOf } from "./replay.ts";
import { STOP_KEY, Trace } from "./trace.ts";
import type {
	Answer,
	Ask,
	ChoiceQuestion,
	Decider,
	DecisionRequest,
	DecisionResult,
	Domain,
	Entry,
	JsonObject,
	Limits,
	MenuItem,
	Question,
	State,
	Usage,
	View,
} from "./types.ts";
import { DEFAULT_LIMITS } from "./types.ts";

export interface RunOptions {
	readonly case: string;
	readonly limits?: Limits;
	readonly trace?: Trace;
	/** A trace to repeat: the run takes its recorded observations and runs no action again, up to a fork. */
	readonly replay?: Replay;
}

/**
 * Why evidence gathering ended: the model chose the stop option, the menu was empty, the run took as many steps as its
 * limits allow, or the choice failed.
 */
export type Ending = "stop" | "no options" | "step limit" | "no choice";

export interface RunResult {
	/** Every question's answer, or null when the answers could not be obtained. */
	readonly answers: Readonly<Record<string, Answer>> | null;
	readonly steps: number;
	readonly ended: Ending;
	readonly error: string | null;
	readonly trace: Trace;
	/** Every observation the case made, the start included, in order. */
	readonly log: readonly Entry[];
}

/** How much smaller each retry's view is after the model reported that a request did not fit its window. */
const SHRINK = 0.7;
const ATTEMPTS = 3;
/** The share of a request that the questions of one answer batch may take. */
const QUESTION_SHARE = 0.4;

/** Runs a domain on one case: the model picks steps from the menu until it stops, then answers the questions. */
export async function run<W>(
	domain: Domain<W>,
	workspace: W,
	decider: Decider,
	options: RunOptions,
): Promise<RunResult> {
	const limits = options.limits ?? DEFAULT_LIMITS;
	const trace = options.trace ?? new Trace();
	trace.caseStarted({
		case: options.case,
		domain: domain.name,
		version: domain.version,
		model: decider.model,
		limits,
	});
	const log: Entry[] = [];
	for (const entry of await startOf(domain, workspace, options.replay)) {
		log.push(entry);
		trace.observed(0, entry.action, entry.key, entry.observation);
	}
	const { steps, ended } = await gather(domain, { workspace, log }, decider, limits, trace, options.replay);
	const questions = domain.questions(workspace);
	const outcome = await answer(domain, { workspace, log }, decider, limits, questions, trace);
	return { answers: outcome.answers, steps, ended, error: outcome.error, trace, log };
}

async function gather<W>(
	domain: Domain<W>,
	state: State<W> & { log: Entry[] },
	decider: Decider,
	limits: Limits,
	trace: Trace,
	replay: Replay | undefined,
): Promise<{ steps: number; ended: Ending }> {
	let step = 0;
	while (step < limits.steps) {
		const menu = buildMenu(domain.actions, state, limits.options - 1);
		if (menu.length === 0) return { steps: step, ended: "no options" };
		step += 1;
		trace.menu(step, menu, domain.stop);
		const chosen = await choose(domain, state, decider, limits, menu, trace);
		if (chosen === null) return { steps: step, ended: "no choice" };
		trace.chose(step, chosen.key, chosen.probabilities, chosen.usage);
		if (chosen.item === null) return { steps: step, ended: "stop" };
		const observation = await observe(chosen.item, step, replay);
		state.log.push({ action: chosen.item.action, key: chosen.item.key, observation });
		trace.observed(step, chosen.item.action, chosen.item.key, observation);
	}
	return { steps: step, ended: "step limit" };
}

interface Chosen {
	readonly item: MenuItem | null;
	readonly key: string;
	readonly probabilities: Readonly<Record<string, number>>;
	readonly usage: Usage;
}

async function choose<W>(
	domain: Domain<W>,
	state: State<W>,
	decider: Decider,
	limits: Limits,
	menu: readonly MenuItem[],
	trace: Trace,
): Promise<Chosen | null> {
	const labels = menu.map((_, index) => `o${String(index + 1)}`);
	const choices: Record<string, string> = {};
	menu.forEach((item, index) => {
		choices[labels[index] ?? item.key] = item.text;
	});
	choices[STOP_KEY] = domain.stop;
	const question: ChoiceQuestion = { kind: "choice", id: "next", instructions: domain.choose, choices };
	const result = await ask(domain, state, decider, limits, [question], trace, undefined, "choose");
	if (!result.ok) {
		trace.note(`the choice failed (${result.failure}): ${result.message}; the case goes on to its answers`);
		return null;
	}
	const picked = result.answers[question.id];
	if (picked?.kind !== "choice") {
		trace.note("the model gave no choice; the case goes on to its answers");
		return null;
	}
	// The stop label is not an option's label, so it maps to no item and keeps its own name as the key.
	const keyOf = (label: string) => menu[labels.indexOf(label)]?.key ?? label;
	const probabilities = Object.fromEntries(
		Object.entries(picked.probabilities).map(([label, p]) => [keyOf(label), p]),
	);
	const item = menu[labels.indexOf(picked.choice)] ?? null;
	return { item, key: keyOf(picked.choice), probabilities, usage: result.usage };
}

/** A judging stage failed: the model's window was exceeded, the provider failed, or a question got no answer. */
export class AskError extends Error {
	override readonly name = "AskError";
}

async function answer<W>(
	domain: Domain<W>,
	state: State<W>,
	decider: Decider,
	limits: Limits,
	questions: readonly Question[],
	trace: Trace,
): Promise<{ answers: Record<string, Answer> | null; error: string | null }> {
	const usages: Usage[] = [];
	const ask = asker(domain, state, decider, limits, trace, usages);
	try {
		const answers =
			domain.judge === undefined
				? await ask(questions, { stage: "answers" })
				: await domain.judge({ state, questions, ask });
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

/** The `ask` a judge gets: batches that fit the window, over the evidence view or a fixed state, each stage traced. */
function asker<W>(
	domain: Domain<W>,
	state: State<W>,
	decider: Decider,
	limits: Limits,
	trace: Trace,
	usages: Usage[],
): Ask {
	const room = Math.floor(decider.window * limits.windowShare * QUESTION_SHARE);
	return async (questions, options) => {
		const answers: Record<string, Answer> = {};
		const used: Usage[] = [];
		for (const batch of batches(questions, room, decider.charsPerToken)) {
			const result =
				options.state === undefined
					? await ask(domain, state, decider, limits, batch, trace, options.extra)
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
	domain: Domain<W>,
	state: State<W>,
	decider: Decider,
	limits: Limits,
	questions: readonly Question[],
	trace: Trace,
	extra: JsonObject | undefined,
	purpose: "choose" | "answer" = "answer",
): Promise<DecisionResult> {
	const budget = Math.floor(decider.window * limits.windowShare);
	let room = budget - estimateTokens(extra === undefined ? questions : [questions, extra], decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = domain.view(state, purpose, room);
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

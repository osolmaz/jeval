import { buildMenu } from "./menu.ts";
import { STOP_KEY, Trace } from "./trace.ts";
import type {
	Answer,
	ChoiceQuestion,
	Decider,
	DecisionRequest,
	DecisionResult,
	Domain,
	Entry,
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
}

export interface RunResult {
	/** Every question's answer, or null when the answers could not be obtained. */
	readonly answers: Readonly<Record<string, Answer>> | null;
	readonly steps: number;
	readonly error: string | null;
	readonly trace: Trace;
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
	for (const entry of await domain.start(workspace)) {
		log.push(entry);
		trace.observed(0, entry.action, entry.key, entry.observation);
	}
	const steps = await gather(domain, { workspace, log }, decider, limits, trace);
	const questions = domain.questions(workspace);
	const outcome = await answer(domain, { workspace, log }, decider, limits, questions, trace);
	return { answers: outcome.answers, steps, error: outcome.error, trace };
}

async function gather<W>(
	domain: Domain<W>,
	state: State<W> & { log: Entry[] },
	decider: Decider,
	limits: Limits,
	trace: Trace,
) {
	let step = 0;
	while (step < limits.steps) {
		const menu = buildMenu(domain.actions, state, limits.options - 1);
		if (menu.length === 0) break;
		step += 1;
		trace.menu(step, menu, domain.stop);
		const chosen = await choose(domain, state, decider, limits, menu, trace);
		if (chosen === null) break;
		trace.chose(step, chosen.key, chosen.probabilities, chosen.usage);
		if (chosen.item === null) break;
		const observation = await chosen.item.run();
		state.log.push({ action: chosen.item.action, key: chosen.item.key, observation });
		trace.observed(step, chosen.item.action, chosen.item.key, observation);
	}
	return step;
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
	const result = await ask(domain, state, decider, limits, [question], "choose", trace);
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

async function answer<W>(
	domain: Domain<W>,
	state: State<W>,
	decider: Decider,
	limits: Limits,
	questions: readonly Question[],
	trace: Trace,
): Promise<{ answers: Record<string, Answer> | null; error: string | null }> {
	const budget = Math.floor(decider.window * limits.windowShare);
	const answers: Record<string, Answer> = {};
	const usages: Usage[] = [];
	for (const batch of batches(questions, Math.floor(budget * QUESTION_SHARE), decider.charsPerToken)) {
		const result = await ask(domain, state, decider, limits, batch, "answer", trace);
		usages.push(result.usage);
		if (!result.ok) return { answers: null, error: `${result.failure}: ${result.message}` };
		Object.assign(answers, result.answers);
	}
	const missing = questions.filter((question) => answers[question.id] === undefined).map((question) => question.id);
	if (missing.length > 0) return { answers: null, error: `no answer for ${missing.join(", ")}` };
	trace.answered(answers, usages);
	return { answers, error: null };
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
	purpose: "choose" | "answer",
	trace: Trace,
): Promise<DecisionResult> {
	const budget = Math.floor(decider.window * limits.windowShare);
	let room = budget - estimateTokens(questions, decider.charsPerToken);
	for (let attempt = 1; ; attempt += 1) {
		const view = domain.view(state, purpose, room);
		noteOmissions(view, trace);
		const result = await decider.decide(request(view, questions));
		if (result.ok || result.failure !== "window" || attempt === ATTEMPTS) return result;
		room = Math.floor(room * SHRINK);
		trace.note(`the request did not fit the model's window; trying a view of ${String(room)} tokens`);
	}
}

function request(view: View, questions: readonly Question[]): DecisionRequest {
	return { state: view.state, images: view.images, questions };
}

function noteOmissions(view: View, trace: Trace): void {
	if (view.omitted.length > 0) trace.note(`the view left out: ${view.omitted.join("; ")}`);
}

export function estimateTokens(value: unknown, charsPerToken: number): number {
	return Math.ceil(JSON.stringify(value).length / charsPerToken);
}

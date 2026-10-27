import {
	type Answer,
	choiceKind,
	type Decider,
	type DecisionRequest,
	type DecisionResult,
	type Domain,
	type Question,
} from "../../src/core/index.ts";

/** A toy domain: a list of named facts the model may look up, and one yes-or-no question per fact. */
export interface Facts {
	readonly facts: Readonly<Record<string, string>>;
}

export const lookUp = choiceKind<Facts, string>({
	name: "look-up",
	menu: (world) =>
		Object.keys(world.facts).map((name) => ({
			key: name,
			text: `Look up ${name}`,
			arg: name,
		})),
	run: (world, name) => ({ source: name, text: world.facts[name] ?? "" }),
});

export const factsDomain: Domain<Facts> = {
	name: "facts",
	version: "1.0.0",
	menu: lookUp,
	stop: "Stop",
	instructions: "Pick the next fact to look up.",
	questions: (world) =>
		Object.keys(world.facts).map((name): Question => ({
			type: "bool",
			id: name,
			instructions: `Is ${name} true?`,
			yes: "yes",
			no: "no",
		})),
	start: () => Promise.resolve([]),
	view: (_, history, purpose, tokens) => ({
		state: { purpose, tokens, seen: history.map((step) => step.observation.text) },
		images: [],
		omitted: tokens < 100 ? ["everything", "the rest"] : [],
	}),
};

const OK_USAGE = { inputTokens: 10, milliseconds: 1 } as const;

export type Policy = (request: DecisionRequest, call: number) => DecisionResult;

/** A decider that answers with `policy` and keeps every request it received. */
export function fakeDecider(policy: Policy, window = 64_000): Decider & { readonly requests: DecisionRequest[] } {
	const requests: DecisionRequest[] = [];
	return {
		model: "fake/decider",
		window,
		charsPerToken: 3,
		requests,
		decide(request) {
			requests.push(request);
			return Promise.resolve(policy(request, requests.length));
		},
	};
}

/** Answers every bool question with `probability`, and every choice question with `pick(labels)`. */
export function answering(
	probability: number,
	pick: (labels: string[]) => string = (labels) => labels.at(-1) ?? "stop",
): Policy {
	return (request) => {
		const answers: Record<string, Answer> = {};
		for (const question of request.questions) {
			if (question.type === "choice") {
				const labels = Object.keys(question.choices);
				const choice = pick(labels);
				answers[question.id] = { type: "choice", choice, probabilities: { [choice]: 0.9 } };
			} else if (question.type === "bool") {
				answers[question.id] = { type: "bool", probability };
			} else {
				answers[question.id] = { type: "score", score: 1, confidence: 0.5 };
			}
		}
		return { ok: true, answers, usage: OK_USAGE };
	};
}

export const failing = (failure: "window" | "provider", message = "failed"): DecisionResult => ({
	ok: false,
	failure,
	message,
	usage: OK_USAGE,
});

/** `policy`, but every "misses" question gets `probability`: a judge that finds nothing missing, by default. */
export function missingNothing(policy: Policy, probability = 0.1): Policy {
	return (request, call) => {
		const result = policy(request, call);
		if (!result.ok) return result;
		const answers: Record<string, Answer> = { ...result.answers };
		for (const id of Object.keys(answers)) if (id.endsWith("/misses")) answers[id] = { type: "bool", probability };
		return { ...result, answers };
	};
}

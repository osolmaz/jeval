import {
	action,
	type Answer,
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

export const lookUp = action<Facts, string>({
	name: "look-up",
	options: (state) =>
		Object.keys(state.workspace.facts).map((name) => ({
			key: name,
			text: `Look up ${name}`,
			arg: name,
			informs: [name],
		})),
	observe: (workspace, name) => ({ source: name, text: workspace.facts[name] ?? "" }),
});

export const factsDomain: Domain<Facts> = {
	name: "facts",
	version: "1.0.0",
	actions: [lookUp],
	stop: "Stop",
	choose: "Pick the next fact to look up.",
	questions: (workspace) =>
		Object.keys(workspace.facts).map((name): Question => ({
			kind: "bool",
			id: name,
			instructions: `Is ${name} true?`,
			yes: "yes",
			no: "no",
		})),
	start: () => Promise.resolve([]),
	view: (state, purpose, tokens) => ({
		state: { purpose, tokens, seen: state.log.map((entry) => entry.observation.text) },
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

/** Answers every bool question with `probability`, and every choice with `pick(choices)`. */
export function answering(
	probability: number,
	pick: (labels: string[]) => string = (labels) => labels.at(-1) ?? "stop",
): Policy {
	return (request) => {
		const answers: Record<string, Answer> = {};
		for (const question of request.questions) {
			if (question.kind === "choice") {
				const labels = Object.keys(question.choices);
				const choice = pick(labels);
				answers[question.id] = { kind: "choice", choice, probabilities: { [choice]: 0.9 } };
			} else if (question.kind === "bool") {
				answers[question.id] = { kind: "bool", probability };
			} else {
				answers[question.id] = { kind: "score", score: 1, confidence: 0.5 };
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

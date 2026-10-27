import type { Answer, Decider, DecisionRequest, DecisionResult } from "../core/index.ts";

const OK_USAGE = { inputTokens: 10, milliseconds: 1 } as const;

/** How a fake decider answers each request: by the request and the request's number, from 1. */
export type Policy = (request: DecisionRequest, call: number) => DecisionResult;

/** A decider that answers with `policy` and keeps every request it received, so that tests make no model calls. */
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

/** A failed request, as a decider reports it: the model's window was too small, or the provider failed. */
export const failing = (failure: "window" | "provider", message = "failed"): DecisionResult => ({
	ok: false,
	failure,
	message,
	usage: OK_USAGE,
});

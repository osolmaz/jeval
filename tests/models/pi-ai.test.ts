import type { ClassifierContext, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "../../src/core/index.ts";
import { type ClassifierRegistry, ModelNotFoundError, piAiDecider } from "../../src/models/pi-ai.ts";

const MODEL = {
	type: "classifier",
	id: "jev-latest",
	provider: "typesafe",
	contextWindow: 64_000,
} as unknown as ClassifierModel<"typesafe-system-one">;

function registry(
	result: Partial<ClassifierResult>,
): ClassifierRegistry & { contexts: ClassifierContext[]; keys: (string | undefined)[] } {
	const contexts: ClassifierContext[] = [];
	const keys: (string | undefined)[] = [];
	return {
		contexts,
		keys,
		getModelOfType: (_, provider, id) => (provider === "typesafe" && id === "jev-latest" ? MODEL : undefined),
		classify(_, context, options) {
			contexts.push(context);
			keys.push(options?.apiKey);
			return Promise.resolve({
				api: "typesafe-system-one",
				provider: "typesafe",
				model: "jev-latest",
				answers: {},
				stopReason: "stop",
				timestamp: 0,
				...result,
			});
		},
	};
}

const request: DecisionRequest = {
	decisionState: { a: 1 },
	decisionImages: [{ type: "image", label: "page", mimeType: "image/png", data: "AAAA" }],
	decisionQuestions: {
		b: { type: "bool", instructions: "B?", criteria: { true: "yes", false: "no" } },
		c: { type: "choice", instructions: "C?", criteria: { x: "X", y: "Y" } },
		s: { type: "score", instructions: "S?", criteria: ["low", "high"] },
	},
};

describe("piAiDecider", () => {
	it("passes the decision request to pi-ai as it is, and gives back pi-ai's result with two fields of its own", async () => {
		const fake = registry({
			answers: {
				b: { type: "bool", probability: 0.75 },
				c: { type: "choice", choice: "x", probabilities: { x: 0.6, y: 0.4 }, confidence: 0.6 },
				s: { type: "score", score: 1, confidence: 0.9 },
			},
			usage: {
				input: 120,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 120,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		});
		let clock = 0;
		const decider = piAiDecider("typesafe/jev-latest", { registry: fake, apiKey: "key", now: () => (clock += 5) });
		expect(decider).toMatchObject({ model: "typesafe/jev-latest", window: 64_000, charsPerToken: 3 });
		const result = await decider.decide(request);
		expect(fake.contexts[0]).toEqual({
			state: { a: 1 },
			images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
			questions: {
				b: { type: "bool", instructions: "B?", criteria: { true: "yes", false: "no" } },
				c: { type: "choice", instructions: "C?", criteria: { x: "X", y: "Y" } },
				s: { type: "score", instructions: "S?", criteria: ["low", "high"] },
			},
		});
		expect(fake.keys).toEqual(["key"]);
		expect(result).toEqual({
			decisionAnswers: {
				b: { type: "bool", probability: 0.75 },
				c: { type: "choice", choice: "x", probabilities: { x: 0.6, y: 0.4 }, confidence: 0.6 },
				s: { type: "score", score: 1, confidence: 0.9 },
			},
			decisionUsage: {
				input: 120,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 120,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			api: "typesafe-system-one",
			provider: "typesafe",
			model: "jev-latest",
			stopReason: "stop",
			timestamp: 0,
			tooLong: false,
			milliseconds: 5,
		});
	});

	it("leaves images out when there are none, and the key to pi-ai when none is given", async () => {
		const fake = registry({});
		const imageless = { decisionState: request.decisionState, decisionQuestions: request.decisionQuestions };
		await piAiDecider("typesafe/jev-latest", { registry: fake }).decide(imageless);
		expect(fake.contexts[0]).not.toHaveProperty("images");
		expect(fake.keys).toEqual([undefined]);
	});

	it("tells an error that the request was too long from other errors", async () => {
		const window = piAiDecider("typesafe/jev-latest", {
			registry: registry({ stopReason: "error", errorMessage: '400 {"error_type":"max_tokens_exceeded"}' }),
		});
		await expect(window.decide(request)).resolves.toMatchObject({ stopReason: "error", tooLong: true });
		const other = piAiDecider("typesafe/jev-latest", { registry: registry({ stopReason: "aborted" }) });
		const aborted = await other.decide(request);
		expect(aborted).toMatchObject({ stopReason: "aborted", tooLong: false });
		expect(aborted).not.toHaveProperty("decisionUsage");
		expect(aborted).not.toHaveProperty("errorMessage");
	});

	it("refuses a model name without a provider or a model pi-ai does not list", () => {
		expect(() => piAiDecider("jev-latest", { registry: registry({}) })).toThrow(ModelNotFoundError);
		expect(() => piAiDecider("typesafe/other", { registry: registry({}) })).toThrow(/lists no classifier model/);
	});
});

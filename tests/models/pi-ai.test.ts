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

	it.each([
		[
			"vLLM-SR",
			'System One API error (400): {"error":{"code":"state_too_long","message":"the state of the request has 33000 characters; at most 32000","type":"systemone_error"}}',
			true,
		],
		[
			"llama.cpp with a causal model",
			'System One API error (400): {"error":{"code":400,"message":"request (3020 tokens) exceeds the available context size (512 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":3020,"n_ctx":512}}',
			true,
		],
		[
			"llama.cpp with an encoder",
			'System One API error (500): {"error":{"code":500,"message":"input (3021 tokens) is too large to process. increase the physical batch size (current batch size: 512)","type":"server_error"}}',
			true,
		],
		[
			"another refusal",
			'System One API error (400): {"error":{"code":"too_many_options","message":"question \\"q\\" of the request has 256 options; at most 255","type":"systemone_error"}}',
			false,
		],
	])("reads the error of %s as too long or not", async (_, errorMessage, tooLong) => {
		const decider = piAiDecider("typesafe/jev-latest", { registry: registry({ stopReason: "error", errorMessage }) });
		await expect(decider.decide(request)).resolves.toMatchObject({ stopReason: "error", tooLong });
	});

	it("refuses a model name without a provider or a model pi-ai does not list", () => {
		expect(() => piAiDecider("jev-latest", { registry: registry({}) })).toThrow(ModelNotFoundError);
		expect(() => piAiDecider("typesafe/other", { registry: registry({}) })).toThrow(/lists no classifier model/);
	});
});

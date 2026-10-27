import type { ClassifierContext, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
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

const request = {
	state: { a: 1 },
	images: [{ label: "page", mimeType: "image/png", data: "AAAA" }],
	questions: [
		{ type: "bool", id: "b", instructions: "B?", yes: "yes", no: "no" },
		{ type: "choice", id: "c", instructions: "C?", choices: { x: "X", y: "Y" } },
		{ type: "score", id: "s", instructions: "S?", levels: ["low", "high"] },
	],
} as const;

describe("piAiDecider", () => {
	it("sends typed questions and images, and reads typed answers back with the confidence of a choice", async () => {
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
			ok: true,
			answers: {
				b: { type: "bool", probability: 0.75 },
				c: { type: "choice", choice: "x", probabilities: { x: 0.6, y: 0.4 }, confidence: 0.6 },
				s: { type: "score", score: 1, confidence: 0.9 },
			},
			usage: { inputTokens: 120, milliseconds: 5 },
		});
	});

	it("leaves images out when there are none, and the key to pi-ai when none is given", async () => {
		const fake = registry({});
		await piAiDecider("typesafe/jev-latest", { registry: fake }).decide({ ...request, images: [] });
		expect(fake.contexts[0]).not.toHaveProperty("images");
		expect(fake.keys).toEqual([undefined]);
	});

	it("tells a window error from other errors", async () => {
		const window = piAiDecider("typesafe/jev-latest", {
			registry: registry({ stopReason: "error", errorMessage: '400 {"error_type":"max_tokens_exceeded"}' }),
		});
		await expect(window.decide(request)).resolves.toMatchObject({ ok: false, failure: "window" });
		const other = piAiDecider("typesafe/jev-latest", { registry: registry({ stopReason: "aborted" }) });
		await expect(other.decide(request)).resolves.toMatchObject({
			ok: false,
			failure: "provider",
			message: "aborted",
			usage: { inputTokens: null },
		});
	});

	it("refuses a model name without a provider or a model pi-ai does not list", () => {
		expect(() => piAiDecider("jev-latest", { registry: registry({}) })).toThrow(ModelNotFoundError);
		expect(() => piAiDecider("typesafe/other", { registry: registry({}) })).toThrow(/lists no classifier model/);
	});
});

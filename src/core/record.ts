import { z } from "zod";
import { answerSchema } from "./trace.ts";
import type { Decider, DecisionRequest, DecisionResult, Json } from "./types.ts";

/** One request to the decision model and its result, as a run's requests file keeps them: images by their labels. */
export interface RecordedRequest {
	readonly request: Omit<DecisionRequest, "decisionImages"> & { readonly decisionImages: readonly string[] };
	readonly result: DecisionResult;
}

const json: z.ZodType<Json> = z.json();
const text = z.string();
export const decisionUsageSchema = z.object({
	input: z.number(),
	output: z.number(),
	cacheRead: z.number(),
	cacheWrite: z.number(),
	cacheWrite1h: z.number().optional(),
	reasoning: z.number().optional(),
	totalTokens: z.number(),
	cost: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
		total: z.number(),
	}),
});
const questionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("bool"), instructions: text, criteria: z.object({ true: text, false: text }) }),
	z.object({ type: z.literal("choice"), instructions: text, criteria: z.record(z.string(), text) }),
	z.object({ type: z.literal("score"), instructions: text, criteria: z.array(text) }),
]);

/** One line of a run's requests file. */
export const recordedRequestSchema = z.object({
	request: z.object({
		decisionState: z.record(z.string(), json),
		decisionImages: z.array(z.string()),
		decisionQuestions: z.record(z.string(), questionSchema),
	}),
	result: z.object({
		decisionAnswers: z.record(z.string(), answerSchema),
		decisionUsage: decisionUsageSchema.optional(),
		api: z.string(),
		provider: z.string(),
		model: z.string(),
		stopReason: z.enum(["stop", "error", "aborted"]),
		errorMessage: z.string().optional(),
		timestamp: z.number(),
		tooLong: z.boolean(),
		milliseconds: z.number(),
	}),
});

/** Reads a requests file's JSON Lines text, checking every line. */
export function parseRequests(text: string): z.infer<typeof recordedRequestSchema>[] {
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => recordedRequestSchema.parse(JSON.parse(line)));
}

/** `decider`, passing every request it gets and the result it gives to `record`, in the order the results come back. */
export function recording(decider: Decider, record: (recorded: RecordedRequest) => void): Decider {
	return {
		model: decider.model,
		window: decider.window,
		charsPerToken: decider.charsPerToken,
		async decide(request) {
			const result = await decider.decide(request);
			const decisionImages = request.decisionImages.map((image) => image.label);
			record({ request: { ...request, decisionImages }, result });
			return result;
		},
	};
}

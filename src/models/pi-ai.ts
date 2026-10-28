import type {
	ClassifierApi,
	ClassifierContext,
	ClassifierModel,
	ClassifierQuestion,
	ClassifierResult,
	ModelsClassifierOptions,
} from "@earendil-works/pi-ai";
import type { Decider, DecisionRequest, DecisionResult, Question } from "../core/index.ts";

/** The part of pi-ai's model registry that switch uses; tests pass a fake. */
export interface ClassifierRegistry {
	getModelOfType(type: "classifier", provider: string, id: string): ClassifierModel<ClassifierApi> | undefined;
	classify(
		model: ClassifierModel<ClassifierApi>,
		context: ClassifierContext,
		options?: ModelsClassifierOptions,
	): Promise<ClassifierResult>;
}

export interface PiAiDeciderOptions {
	readonly registry: ClassifierRegistry;
	/** The API key; without it, pi-ai finds the provider's key itself, such as `TYPESAFE_API_KEY`. */
	readonly apiKey?: string;
	readonly timeoutMs?: number;
	/** Characters per token for size estimates; 3 is safe for English and JSON. */
	readonly charsPerToken?: number;
	readonly now?: () => number;
}

export class ModelNotFoundError extends Error {
	override readonly name = "ModelNotFoundError";
}

/** Errors that mean the request was larger than the model's window. */
const TOO_LONG = /max_tokens_exceeded|context length|too long|too many tokens/i;

/**
 * A decider for a pi-ai classifier model named `provider/id`, for example `typesafe/jev-latest`. It passes the decision
 * request to pi-ai as it is and gives back pi-ai's result, with whether the request was too long and how long it took.
 */
export function piAiDecider(name: string, options: PiAiDeciderOptions): Decider {
	const slash = name.indexOf("/");
	if (slash <= 0) throw new ModelNotFoundError(`a model is named provider/id, not "${name}"`);
	const model = options.registry.getModelOfType("classifier", name.slice(0, slash), name.slice(slash + 1));
	if (model === undefined) throw new ModelNotFoundError(`pi-ai lists no classifier model ${name}`);
	const now = options.now ?? Date.now;
	const requestOptions: ModelsClassifierOptions = {
		...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
		timeoutMs: options.timeoutMs ?? 300_000,
		maxRetries: 2,
	};
	return {
		model: name,
		window: model.contextWindow,
		charsPerToken: options.charsPerToken ?? 3,
		async decide(request: DecisionRequest): Promise<DecisionResult> {
			const started = now();
			const result = await options.registry.classify(model, contextOf(request), requestOptions);
			return resultOf(result, now() - started);
		},
	};
}

/** pi-ai's context: the decision request's state, images and questions, with each image's label left out. */
function contextOf(request: DecisionRequest): ClassifierContext {
	const questions = Object.fromEntries(
		Object.entries(request.decisionQuestions).map(([id, question]) => [id, questionOf(question)]),
	);
	const images = request.decisionImages.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType }));
	return { state: request.decisionState, questions, ...(images.length > 0 ? { images } : {}) };
}

/** The same question, as pi-ai's mutable type takes it. */
function questionOf(question: Question): ClassifierQuestion {
	switch (question.type) {
		case "bool":
			return { ...question, criteria: { ...question.criteria } };
		case "choice":
			return { ...question, criteria: { ...question.criteria } };
		case "score":
			return { ...question, criteria: [...question.criteria] };
	}
}

/** pi-ai's result as it is, with switch's two fields. */
function resultOf(result: ClassifierResult, milliseconds: number): DecisionResult {
	const { answers, usage, errorMessage, api, provider, model, stopReason, timestamp } = result;
	return {
		decisionAnswers: answers,
		...(usage === undefined ? {} : { decisionUsage: usage }),
		api,
		provider,
		model,
		stopReason,
		...(errorMessage === undefined ? {} : { errorMessage }),
		timestamp,
		tooLong: stopReason === "error" && TOO_LONG.test(errorMessage ?? ""),
		milliseconds,
	};
}

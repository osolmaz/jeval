import type {
	ClassifierAnswer,
	ClassifierApi,
	ClassifierContext,
	ClassifierModel,
	ClassifierQuestion,
	ClassifierResult,
	ModelsClassifierOptions,
} from "@earendil-works/pi-ai";
import type { Answer, Decider, DecisionRequest, DecisionResult, Question } from "../core/index.ts";

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
const WINDOW_ERROR = /max_tokens_exceeded|context length|too long|too many tokens/i;

/** A decider for a pi-ai classifier model named `provider/id`, for example `typesafe/jev-latest`. */
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
			const result = await options.registry.classify(model, toContext(request), requestOptions);
			const usage = { inputTokens: result.usage?.input ?? null, milliseconds: now() - started };
			if (result.stopReason !== "stop") {
				const message = result.errorMessage ?? result.stopReason;
				return { ok: false, failure: WINDOW_ERROR.test(message) ? "window" : "provider", message, usage };
			}
			return { ok: true, answers: fromAnswers(result.answers), usage };
		},
	};
}

/** The API's request: the API calls the JSON that the model reads `state`. */
function toContext(request: DecisionRequest): ClassifierContext {
	const questions = Object.fromEntries(request.questions.map((question) => [question.id, toQuestion(question)]));
	const images = request.images.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType }));
	return { state: request.json, questions, ...(images.length > 0 ? { images } : {}) };
}

/** The API's question for switch's: the same `type` and instructions, with switch's texts as the API's `criteria`. */
function toQuestion(question: Question): ClassifierQuestion {
	switch (question.type) {
		case "bool":
			return {
				type: "bool",
				instructions: question.instructions,
				criteria: { true: question.yes, false: question.no },
			};
		case "choice":
			return { type: "choice", instructions: question.instructions, criteria: { ...question.choices } };
		case "score":
			return { type: "score", instructions: question.instructions, criteria: [...question.levels] };
	}
}

function fromAnswers(answers: Readonly<Record<string, ClassifierAnswer>>): Record<string, Answer> {
	return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, fromAnswer(answer)]));
}

function fromAnswer(answer: ClassifierAnswer): Answer {
	switch (answer.type) {
		case "bool":
			return { type: "bool", probability: answer.probability };
		case "choice":
			return {
				type: "choice",
				choice: answer.choice,
				probabilities: answer.probabilities,
				confidence: answer.confidence,
			};
		case "score":
			return { type: "score", score: answer.score, confidence: answer.confidence };
	}
}

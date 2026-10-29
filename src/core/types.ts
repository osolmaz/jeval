/**
 * The building blocks of switch. A domain gives each case as a state machine: an initial state, a question function
 * that gives the questions that the model must answer in a state, and a transition function that gives the next state
 * from the answers. The core runs the loop: it asks the questions of each state until the domain asks nothing more.
 *
 * What goes to the decision model and comes back follows pi-ai's classifier interface: its request, questions,
 * answers, result and usage. A field of the decision request or the decision result that carries pi-ai's content takes
 * the prefix `decision`, so that "state" in switch means only the state of a case. switch's own records, such as the
 * trace and a case's result, keep the same answers and usage under plain names.
 */
import type { Trace } from "./trace.ts";

export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: Json;
}

/** An image that the model reads with the decision state: pi-ai's image, with a label for the requests file. */
export interface Image {
	readonly type: "image";
	/** Names the image in the requests file, which keeps no image bytes; the model never sees it. */
	readonly label: string;
	readonly mimeType: string;
	/** Base64-encoded bytes. */
	readonly data: string;
}

/** What every question has: its instructions, and facts of switch's own that the model never sees. */
interface QuestionBase {
	readonly instructions: string;
	/**
	 * switch's own: facts about the question for the trace and the tools that read it, such as what each label of a
	 * pick stands for. switch takes them out of the request, so the model never sees them.
	 */
	readonly data?: JsonObject | undefined;
}
/** A yes-or-no question, as pi-ai has it: `criteria` says what true and false mean. */
export interface BoolQuestion extends QuestionBase {
	readonly type: "bool";
	readonly criteria: { readonly true: string; readonly false: string };
}
/** Which of these fits: `criteria` gives each choice's label and the text the model reads for it. */
export interface ChoiceQuestion extends QuestionBase {
	readonly type: "choice";
	readonly criteria: Readonly<Record<string, string>>;
}
/** Where on this scale it is: `criteria` gives the meaning of each level, from the lowest to the highest. */
export interface ScoreQuestion extends QuestionBase {
	readonly type: "score";
	readonly criteria: readonly string[];
}
export type Question = BoolQuestion | ChoiceQuestion | ScoreQuestion;
/** Questions by id: the answers come back under the same ids. */
export type Questions = Readonly<Record<string, Question>>;

export interface BoolAnswer {
	readonly type: "bool";
	/** The probability of true. */
	readonly probability: number;
}
export interface ChoiceAnswer {
	readonly type: "choice";
	/** The label of the picked choice. */
	readonly choice: string;
	/** The probability of each choice, by label. */
	readonly probabilities: Readonly<Record<string, number>>;
	readonly confidence: number;
}
export interface ScoreAnswer {
	readonly type: "score";
	readonly score: number;
	readonly confidence: number;
}
export type Answer = BoolAnswer | ChoiceAnswer | ScoreAnswer;
/** Answers by question id. */
export type Answers = Readonly<Record<string, Answer>>;

/** One request to the decision model, in the form of pi-ai's ClassifierContext. */
export interface DecisionRequest {
	/** pi-ai's `state`: what the model reads. */
	readonly decisionState: JsonObject;
	/** pi-ai's `images`: what the model sees with it, when anything. */
	readonly decisionImages?: readonly Image[];
	/** pi-ai's `questions`, without switch's own `data`. */
	readonly decisionQuestions: Questions;
}

/** What the view function gives: the decision request without its questions, which switch adds. */
export type View = Omit<DecisionRequest, "decisionQuestions">;

/** pi-ai's `Usage`: token counts, and their cost in US dollars at the model's catalog price. */
export interface DecisionUsage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly cacheWrite1h?: number;
	readonly reasoning?: number;
	readonly totalTokens: number;
	readonly cost: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
	};
}

/** The decision model's result, in the form of pi-ai's ClassifierResult, with two fields of switch's own. */
export interface DecisionResult {
	/** pi-ai's `answers`. Empty when `stopReason` is not "stop". */
	readonly decisionAnswers: Answers;
	/** pi-ai's `usage`, when the API reports token counts. */
	readonly decisionUsage?: DecisionUsage;
	readonly api: string;
	readonly provider: string;
	/** The model that was asked. */
	readonly model: string;
	readonly stopReason: "stop" | "error" | "aborted";
	readonly errorMessage?: string;
	readonly timestamp: number;
	/** switch's own: the error says that the request was larger than the model's window, so a smaller view may fit. */
	readonly tooLong: boolean;
	/** switch's own: how long the call took, which pi-ai does not report. */
	readonly milliseconds: number;
}

/** A decision model behind pi-ai's classifier interface. */
export interface Decider {
	/** The model, as `provider/id`. */
	readonly model: string;
	/** The model's window in tokens. */
	readonly window: number;
	/** Characters per token for the size estimate; lower is safer. */
	readonly charsPerToken: number;
	decide(request: DecisionRequest): Promise<DecisionResult>;
}

/**
 * One case as a state machine: the interface between a domain and switch. The case's fixed data stays inside the
 * functions, and a state is JSON, so that the trace can keep every one.
 */
export interface StateMachine<S extends JsonObject> {
	/** The state before the first step. */
	initial(): Promise<S>;
	/** The question function: the questions that the model must answer in a state, by id. Nothing to ask ends the run. */
	questions(state: S): Questions;
	/** The transition function: the next state, from the state and the model's answer to each of its questions. */
	transition(state: S, answers: Answers): Promise<S>;
	/**
	 * What the model reads in a state, in at most `tokens` tokens as `estimateTokens` counts them at `charsPerToken`;
	 * the state as it is by default.
	 */
	view?(state: S, tokens: number, charsPerToken: number): Promise<View>;
}

/** One answer that a pick offers: what the model reads for it, and what the domain knows of it. */
export interface Choice {
	/** What sort of choice it is, for the trace. */
	readonly type: string;
	/** Unique among the choices of a state. */
	readonly key: string;
	/** What the model reads. */
	readonly text: string;
	/** Lower keeps the choice when the choices must be cut; 0 by default. */
	readonly priority?: number;
	/** Facts about the choice for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
}

export interface Limits {
	/** The most steps of a run: a safety net against a run that never ends. None by default. */
	readonly steps?: number | undefined;
	/** Tokens a request may use, as a share of the model's window. */
	readonly windowShare: number;
}

/**
 * What a domain lets a run vary, such as the texts that tell the model what to do, and the limits: what a run records.
 * The texts in the domain's code, such as those of its choices, come with the domain's version.
 */
export interface Definition {
	readonly name: string;
	/** The SHA-256 of `content` as JSON, so formatting does not count. */
	readonly hash: string;
	readonly content: JsonObject;
}

/**
 * Why a run ended: the domain asked nothing more, the run took as many steps as its limits allow, or a request failed
 * or gave answers that do not fit its questions.
 */
export type Ending = "done" | "step limit" | "failed";

export interface RunResult<S extends JsonObject = JsonObject> {
	readonly steps: number;
	readonly ended: Ending;
	/** Why the run failed; null when it did not. */
	readonly error: string | null;
	readonly trace: Trace;
	/** The last state of the case. */
	readonly state: S;
}

/** A domain, as a harness runs it on case folders: what every case shares, and the state machine of a case folder. */
export interface Domain<S extends JsonObject> {
	/** The name and the version go into the trace and the run's record. */
	readonly name: string;
	readonly version: string;
	readonly limits: Limits;
	/** The domain's own definition, such as a file it was set up from; by default, its limits. */
	readonly definition?: Definition;
	/** The case id in a case folder, read without loading the whole case. */
	caseId(folder: string): Promise<string>;
	/** The state machine of a case folder. */
	load(folder: string): Promise<StateMachine<S>>;
	/** How the case ended in the domain's own terms, from the run's result and its last state; none when it is missing. */
	outcome?(result: RunResult<S>): JsonObject;
}

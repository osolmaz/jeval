/**
 * The building blocks of switch. A domain gives each case as a state machine: an initial state, a choice function that
 * gives the choices in a state, and a transition function that gives the state after a choice. The core runs the loop:
 * the decision model picks from the choices until it picks stop, then it answers the questions.
 *
 * What goes to the decision model and comes back follows pi-ai's classifier interface: its request, questions,
 * answers, result and usage. A field that carries pi-ai's content takes the prefix `decision`, so that "state" in
 * switch means only the state of a case.
 */
import type { Trace } from "./trace.ts";

export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: Json;
}

/** An image that the model reads with the decision state; pi-ai's image, with a label for the requests file. */
export interface Image {
	/** Names the image in the requests file, which keeps no image bytes; the model never sees it. */
	readonly label: string;
	readonly mimeType: string;
	/** Base64-encoded bytes. */
	readonly data: string;
}

/** One thing that the model can do in a state. Stop is a choice too, which the core adds. */
export interface Choice {
	/** What sort of choice it is, for the trace. */
	readonly type: string;
	/** Unique in a run: the model picks a key at most once. */
	readonly key: string;
	/** What the model reads. */
	readonly text: string;
	/** Lower keeps the choice when the choices must be cut; 0 by default. */
	readonly priority?: number;
	/** Facts about the choice for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
}

/** A yes-or-no question, as pi-ai has it: `criteria` says what true and false mean. */
export interface BoolQuestion {
	readonly type: "bool";
	readonly instructions: string;
	readonly criteria: { readonly true: string; readonly false: string };
}
/** Which of these options fits: `criteria` gives each option's label and the text the model reads for it. */
export interface ChoiceQuestion {
	readonly type: "choice";
	readonly instructions: string;
	readonly criteria: Readonly<Record<string, string>>;
}
/** Where on this scale it is: `criteria` gives the meaning of each level, from the lowest to the highest. */
export interface ScoreQuestion {
	readonly type: "score";
	readonly instructions: string;
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
	readonly choice: string;
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
	/** pi-ai's `images`: what the model sees with it. */
	readonly decisionImages: readonly Image[];
	/** pi-ai's `questions`. */
	readonly decisionQuestions: Questions;
}

/** What the view function gives: the decision request without its questions, which switch adds. */
export type View = Omit<DecisionRequest, "decisionQuestions">;

/** Why the view function is called: for a pick, or for the answers at the end. */
export type Purpose = "pick" | "answer";

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

/** A view function of an answer stage's own, for `tokens` estimated tokens at `charsPerToken`. */
export type StageView = (tokens: number, charsPerToken: number) => Promise<View>;

/** How an answer stage asks questions: over the domain's view for the answers, or over a view of the stage's own. */
export interface AskOptions {
	/** The stage's name in the trace. */
	readonly stage: string;
	/** The stage's own view, such as the domain's view with a description of the stage added. */
	readonly view?: StageView;
}

/** Asks questions in as many requests as the window needs and returns every answer; it throws `AskError` on failure. */
export type Ask = (questions: Questions, options: AskOptions) => Promise<Answers>;

export interface AnswerContext<S> {
	/** The last state of the case. */
	readonly state: S;
	/** The questions: the answer stages must answer every one. */
	readonly questions: Questions;
	readonly ask: Ask;
}

/**
 * One case as a state machine: the interface between a domain and switch. The case's fixed data stays inside the
 * functions, and a state is JSON, so that the trace can keep every one.
 */
export interface StateMachine<S extends JsonObject, C extends Choice = Choice> {
	/** The state before the first pick. */
	initial(): Promise<S>;
	/** The choice function: the choices in a state. */
	choices(state: S): readonly C[];
	/** The transition function: the state after the model picked `choice` in `state`. */
	transition(state: S, choice: C): Promise<S>;
	/**
	 * What the model reads in a state, in at most `tokens` tokens as `estimateTokens` counts them at `charsPerToken`;
	 * the state as it is by default.
	 */
	view?(state: S, purpose: Purpose, tokens: number, charsPerToken: number): Promise<View>;
	/** The questions that the model answers over the last state, by id; none by default. */
	questions?(): Questions;
	/** Answers the questions in stages of its own; without it, the questions are asked once over the view. */
	answer?(context: AnswerContext<S>): Promise<Answers>;
}

export interface Limits {
	readonly steps: number;
	/** The most choices that the model sees in one step, stop included. */
	readonly choices: number;
	/** Tokens a request may use, as a share of the model's window. */
	readonly windowShare: number;
}

/** Every text a domain gives the model that does not come from a case, and its limits: what a run records. */
export interface Definition {
	readonly name: string;
	/** The SHA-256 of `content` as JSON, so formatting does not count. */
	readonly hash: string;
	readonly content: JsonObject;
}

/**
 * Why the steps ended: the model picked stop, the state had no choices, the run took as many steps as its limits
 * allow, or the pick failed.
 */
export type Ending = "stop" | "no choices" | "step limit" | "pick failed";

export interface RunResult<S extends JsonObject = JsonObject> {
	/** Every question's answer, or null when the answers could not be obtained. */
	readonly answers: Answers | null;
	readonly steps: number;
	readonly ended: Ending;
	/** Why the answers could not be obtained; null when they were. */
	readonly error: string | null;
	readonly trace: Trace;
	/** The last state of the case. */
	readonly state: S;
}

/** A domain, as a harness runs it on case folders: what every case shares, and the state machine of a case folder. */
export interface Domain<S extends JsonObject, C extends Choice = Choice> {
	/** The name and the version go into the trace and the run's record. */
	readonly name: string;
	readonly version: string;
	/** The text of the stop choice, which ends the steps. */
	readonly stop: string;
	/** The text that tells the model how to pick from the choices. */
	readonly instructions: string;
	readonly limits: Limits;
	/** The domain's own definition, such as a file it was set up from; by default, its stop, instructions and limits. */
	readonly definition?: Definition;
	/** The case id in a case folder, read without loading the whole case. */
	caseId(folder: string): Promise<string>;
	/** The state machine of a case folder. */
	load(folder: string): Promise<StateMachine<S, C>>;
	/** How the case ended in the domain's own terms, from its last state; none when it is missing. */
	outcome?(state: S, result: RunResult<S>): JsonObject;
}

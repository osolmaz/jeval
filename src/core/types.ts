/**
 * The building blocks of switch. A domain gives each case as a state machine: an initial state, a choice function that
 * gives the choices in a state, and a transition function that gives the state after a choice. The core runs the loop:
 * the decision model picks from the choices until it picks stop, then it answers the questions.
 */
import type { Trace } from "./trace.ts";

export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: Json;
}

/** An image sent with the view to a model that accepts images. */
export interface Image {
	readonly label: string;
	readonly mimeType: string;
	/** Base64-encoded bytes. */
	readonly data: string;
}

/** One thing that the model can do in a state. Stop is a choice too, which the core adds. */
export interface Choice {
	/** What sort of choice it is, for the trace and the viewer. */
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

export interface BoolQuestion {
	readonly type: "bool";
	readonly id: string;
	readonly instructions: string;
	readonly yes: string;
	readonly no: string;
}
export interface ChoiceQuestion {
	readonly type: "choice";
	readonly id: string;
	readonly instructions: string;
	/** Each choice's label and the text the model reads for it. */
	readonly choices: Readonly<Record<string, string>>;
}
export interface ScoreQuestion {
	readonly type: "score";
	readonly id: string;
	readonly instructions: string;
	/** The meaning of each score, from the lowest to the highest. */
	readonly levels: readonly string[];
}
export type Question = BoolQuestion | ChoiceQuestion | ScoreQuestion;

export interface BoolAnswer {
	readonly type: "bool";
	readonly probability: number;
}
export interface ChoiceAnswer {
	readonly type: "choice";
	readonly choice: string;
	readonly probabilities: Readonly<Record<string, number>>;
	/** How sure the model is of its choice, when the model reports it. */
	readonly confidence?: number | undefined;
}
export interface ScoreAnswer {
	readonly type: "score";
	readonly score: number;
	readonly confidence: number;
}
export type Answer = BoolAnswer | ChoiceAnswer | ScoreAnswer;

/** What the model reads in a state: JSON and images. `omitted` names what the view left out to fit. */
export interface View {
	readonly json: JsonObject;
	readonly images: readonly Image[];
	readonly omitted: readonly string[];
}

/** How an answer stage asks questions: over the view, or over fixed JSON of the stage's own. */
export interface AskOptions {
	/** The stage's name in the trace. */
	readonly stage: string;
	/** JSON to send in place of the view; it is sent as is and never cut. */
	readonly json?: JsonObject;
	/** Fields added to the view's JSON, such as a description of the stage. */
	readonly extra?: JsonObject;
}

/** Asks questions in as many requests as the window needs and returns every answer; it throws `AskError` on failure. */
export type Ask = (questions: readonly Question[], options: AskOptions) => Promise<Readonly<Record<string, Answer>>>;

export interface AnswerContext<S> {
	/** The last state of the case. */
	readonly state: S;
	/** The questions: the answer stages must answer every one. */
	readonly questions: readonly Question[];
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
	/** What the model reads in a state, in at most `tokens` estimated tokens; the state as it is by default. */
	view?(state: S, purpose: "choose" | "answer", tokens: number): Promise<View>;
	/** The questions that the model answers over the last state; none by default. */
	questions?(): readonly Question[];
	/** Answers the questions in stages of its own; without it, the questions are asked once over the view. */
	answer?(context: AnswerContext<S>): Promise<Readonly<Record<string, Answer>>>;
}

export interface Usage {
	readonly inputTokens: number | null;
	readonly milliseconds: number;
}

export interface DecisionRequest {
	/** The JSON that the model reads. */
	readonly json: JsonObject;
	readonly images: readonly Image[];
	readonly questions: readonly Question[];
}

export type DecisionFailure = "window" | "provider";
export type DecisionResult =
	| { readonly ok: true; readonly answers: Readonly<Record<string, Answer>>; readonly usage: Usage }
	| { readonly ok: false; readonly failure: DecisionFailure; readonly message: string; readonly usage: Usage };

/** A decision model behind a typed-question interface. */
export interface Decider {
	readonly model: string;
	/** The model's window in tokens. */
	readonly window: number;
	/** Characters per token for the size estimate; lower is safer. */
	readonly charsPerToken: number;
	decide(request: DecisionRequest): Promise<DecisionResult>;
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
	readonly answers: Readonly<Record<string, Answer>> | null;
	readonly steps: number;
	readonly ended: Ending;
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
	readonly definition: Definition;
	readonly limits: Limits;
	/** The case id in a case folder, read without loading the whole case. */
	caseId(folder: string): Promise<string>;
	/** The state machine of a case folder. */
	load(folder: string): Promise<StateMachine<S, C>>;
	/** How the case ended in the domain's own terms, from its last state; none when it is missing. */
	outcome?(state: S, result: RunResult<S>): JsonObject;
}

/** One request to the decision model and its result, as a run's requests file keeps them. Images appear by label. */
export interface Exchange {
	readonly request: {
		readonly json: JsonObject;
		readonly images: readonly string[];
		readonly questions: readonly Question[];
	};
	readonly result: DecisionResult;
}

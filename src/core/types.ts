/**
 * The building blocks of Switch: a domain declares actions, questions and a view over a workspace; the core runs the
 * loop that lets a decision model choose actions until it can answer the questions.
 */

export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
	readonly [key: string]: Json;
}

/** An image sent with the state to a model that accepts images. */
export interface Image {
	readonly label: string;
	readonly mimeType: string;
	/** Base64-encoded bytes. */
	readonly data: string;
}

/** What one step found: text for the view, and images when the step looked at one. */
export interface Observation {
	readonly source: string;
	readonly text: string;
	readonly images?: readonly Image[];
}

/** One taken step in the observation log. `key` identifies the option, so a step is never offered twice. */
export interface Entry {
	readonly action: string;
	readonly key: string;
	readonly observation: Observation;
}

/** The workspace of a case and the observations made so far. */
export interface State<W> {
	readonly workspace: W;
	readonly log: readonly Entry[];
}

/** One concrete option on the menu, ready to run. */
export interface MenuItem {
	readonly action: string;
	readonly key: string;
	readonly text: string;
	/** The questions this option bears on. */
	readonly informs: readonly string[];
	/** Lower keeps the option when the menu must be cut; 0 by default. */
	readonly priority: number;
	readonly run: () => Promise<Observation>;
}

/** An action schema, with its argument type erased so that a domain can list actions of different arguments. */
export interface Action<W> {
	readonly name: string;
	items(state: State<W>): readonly MenuItem[];
}

export interface BoolQuestion {
	readonly kind: "bool";
	readonly id: string;
	readonly instructions: string;
	readonly yes: string;
	readonly no: string;
}
export interface ChoiceQuestion {
	readonly kind: "choice";
	readonly id: string;
	readonly instructions: string;
	/** Each choice's label and the text the model reads for it. */
	readonly choices: Readonly<Record<string, string>>;
}
export interface ScoreQuestion {
	readonly kind: "score";
	readonly id: string;
	readonly instructions: string;
	/** The meaning of each score, from the lowest to the highest. */
	readonly levels: readonly string[];
}
export type Question = BoolQuestion | ChoiceQuestion | ScoreQuestion;

export interface BoolAnswer {
	readonly kind: "bool";
	readonly probability: number;
}
export interface ChoiceAnswer {
	readonly kind: "choice";
	readonly choice: string;
	readonly probabilities: Readonly<Record<string, number>>;
}
export interface ScoreAnswer {
	readonly kind: "score";
	readonly score: number;
	readonly confidence: number;
}
export type Answer = BoolAnswer | ChoiceAnswer | ScoreAnswer;

/** What the model sees: the JSON state and its images. `omitted` names what the view left out to fit. */
export interface View {
	readonly state: JsonObject;
	readonly images: readonly Image[];
	readonly omitted: readonly string[];
}

/** How a judging stage asks questions: over the evidence view, or over a fixed state such as one rubric item. */
export interface AskOptions {
	/** The stage's name in the trace. */
	readonly stage: string;
	/** A fixed state instead of the evidence view; it is sent as is and never cut. */
	readonly state?: JsonObject;
	/** Fields added to the evidence view's state, such as a description of the stage. */
	readonly extra?: JsonObject;
}

/** Asks questions in as many requests as the window needs and returns every answer; it throws `AskError` on failure. */
export type Ask = (questions: readonly Question[], options: AskOptions) => Promise<Readonly<Record<string, Answer>>>;

export interface JudgeContext<W> {
	readonly state: State<W>;
	/** The domain's questions: the judge must answer every one. */
	readonly questions: readonly Question[];
	readonly ask: Ask;
}

export interface Domain<W> {
	readonly name: string;
	readonly version: string;
	readonly actions: readonly Action<W>[];
	/** The text of the option that ends evidence gathering. */
	readonly stop: string;
	/** The instructions of the question that picks the next step. */
	readonly choose: string;
	questions(workspace: W): readonly Question[];
	/** The observations every case starts with, made before the first choice. */
	start(workspace: W): Promise<readonly Entry[]>;
	/** The state the model sees, in at most `tokens` estimated tokens. */
	view(state: State<W>, purpose: "choose" | "answer", tokens: number): View;
	/**
	 * Answers the questions in stages of its own, such as checking each part of an item before deciding the item.
	 * Without it, the questions are asked once over the evidence view.
	 */
	judge?(context: JudgeContext<W>): Promise<Readonly<Record<string, Answer>>>;
}

export interface Usage {
	readonly inputTokens: number | null;
	readonly milliseconds: number;
}

export interface DecisionRequest {
	readonly state: JsonObject;
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
	readonly options: number;
	/** Tokens a request may use, as a share of the model's window. */
	readonly windowShare: number;
}

export const DEFAULT_LIMITS: Limits = { steps: 8, options: 30, windowShare: 0.9 };

/** One request to the decision model and its result, as a run's requests file keeps them. Images appear by label. */
export interface Exchange {
	readonly request: {
		readonly state: JsonObject;
		readonly images: readonly string[];
		readonly questions: readonly Question[];
	};
	readonly result: DecisionResult;
}

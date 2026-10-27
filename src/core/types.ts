/**
 * The building blocks of switch. A domain presents its world and the history of a run to a decision model as a menu of
 * choices, and asks questions at the end; the core runs the loop that lets the model pick from the menu until it stops,
 * then answers the questions.
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

/** What a choice found when it ran: text for the view, and images when it looked at one. */
export interface Observation {
	/** Where the text came from, such as a file and its pages, when the domain names it. */
	readonly source?: string;
	readonly text: string;
	readonly images?: readonly Image[];
	/** Facts about the step for tools that read the trace, such as a viewer; the model never sees them. */
	readonly data?: JsonObject;
}

/** One step of the history: the kind and the key of the choice that ran, and what it found. */
export interface Step {
	readonly kind: string;
	readonly key: string;
	readonly observation: Observation;
}

/** One thing the model can do now, ready to run. */
export interface Choice {
	/** A label such as "read" or "move", for the trace and the viewer. */
	readonly kind: string;
	/** Unique in a run: a choice whose key is in the history is not offered again. */
	readonly key: string;
	/** What the model reads. */
	readonly text: string;
	/** Lower keeps the choice when the menu must be cut; 0 by default. */
	readonly priority: number;
	/** Facts about the choice for tools that read the trace; the model never sees them. */
	readonly data?: JsonObject;
	readonly run: () => Promise<Observation>;
}

/** The choices for the current step, from the world and the history: the menu of a domain, or of one kind of choice. */
export type Menu<W> = (world: W, history: readonly Step[]) => readonly Choice[];

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

/** What the model sees: the JSON state and its images. `omitted` names what the view left out to fit. */
export interface View {
	readonly state: JsonObject;
	readonly images: readonly Image[];
	readonly omitted: readonly string[];
}

/** How an answer stage asks questions: over the view, or over a fixed state such as one rubric item. */
export interface AskOptions {
	/** The stage's name in the trace. */
	readonly stage: string;
	/** A fixed state instead of the view's; it is sent as is and never cut. */
	readonly state?: JsonObject;
	/** Fields added to the view's state, such as a description of the stage. */
	readonly extra?: JsonObject;
}

/** Asks questions in as many requests as the window needs and returns every answer; it throws `AskError` on failure. */
export type Ask = (questions: readonly Question[], options: AskOptions) => Promise<Readonly<Record<string, Answer>>>;

export interface AnswerContext<W> {
	readonly world: W;
	readonly history: readonly Step[];
	/** The domain's questions: the answer stages must answer every one. */
	readonly questions: readonly Question[];
	readonly ask: Ask;
}

export interface Domain<W> {
	readonly name: string;
	readonly version: string;
	/** The choices for the current step: how the domain presents its world and the history to the model. */
	readonly menu: Menu<W>;
	/** The text of the stop choice, which ends the steps. */
	readonly stop: string;
	/** The instructions of the menu's question: how the model picks the next step. */
	readonly instructions: string;
	questions(world: W): readonly Question[];
	/** The steps every case starts with, taken before the first pick. */
	start(world: W): Promise<readonly Step[]>;
	/** The state the model sees, in at most `tokens` estimated tokens. */
	view(world: W, history: readonly Step[], purpose: "choose" | "answer", tokens: number): View;
	/**
	 * Answers the questions in stages of its own, such as checking each part of an item before deciding the item.
	 * Without it, the questions are asked once over the view.
	 */
	answer?(context: AnswerContext<W>): Promise<Readonly<Record<string, Answer>>>;
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
	/** The most choices on one menu, stop included. */
	readonly choices: number;
	/** Tokens a request may use, as a share of the model's window. */
	readonly windowShare: number;
}

export const DEFAULT_LIMITS: Limits = { steps: 8, choices: 30, windowShare: 0.9 };

/** One request to the decision model and its result, as a run's requests file keeps them. Images appear by label. */
export interface Exchange {
	readonly request: {
		readonly state: JsonObject;
		readonly images: readonly string[];
		readonly questions: readonly Question[];
	};
	readonly result: DecisionResult;
}

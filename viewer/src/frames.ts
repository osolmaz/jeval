import {
	type Answer,
	type Answers,
	type Ending,
	type JsonObject,
	PICK_ID,
	type Question,
	startOf,
	type TraceEntry,
} from "@osolmaz/switch";

/** One choice of a choice question, with the probability that the model gave it; null until the model answered. */
export interface FrameChoice {
	/** The choice's label in the question. */
	readonly label: string;
	/** The choice's own key, from the question's facts; its label when the question has none. */
	readonly key: string;
	readonly text: string;
	readonly probability: number | null;
	readonly picked: boolean;
	/** The choice's own facts for tools, from the question's facts. */
	readonly data: unknown;
}

/** One question of a step, with its answer: null until the model answered, or when the step failed. */
export interface FrameQuestion {
	readonly id: string;
	readonly question: Question;
	readonly answer: Answer | null;
	/** A choice question's choices in their order; none for a question of another type. */
	readonly choices: readonly FrameChoice[];
	/** How many choices a pick's limit cut, so the model never saw them. */
	readonly cut: number;
}

/** One step of a case: the state it asked in, its questions with their answers, and the state after it. */
export interface Frame {
	readonly step: number;
	/** The state before the step. */
	readonly before: JsonObject | null;
	readonly questions: readonly FrameQuestion[];
	/** The place among `questions` of the step's pick: switch's pick question, or else its first choice question. */
	readonly pick: number | null;
	/** Whether the model answered the step. */
	readonly answered: boolean;
	/** The state after the transition; null until then, or when the step failed. */
	readonly after: JsonObject | null;
	readonly notes: readonly string[];
}

/** A case's trace, read for viewing. */
export interface Story {
	/** The case's name, from the folder that holds the trace. */
	readonly case: string;
	readonly domain: string;
	readonly model: string;
	/** The state before the first step; null until the trace has it. */
	readonly initial: JsonObject | null;
	readonly frames: readonly Frame[];
	/** The latest state of the case. */
	readonly last: JsonObject | null;
	/** Why the run ended; null until it has ended. */
	readonly ended: Ending | null;
	/** Why the run failed; null when it did not, or until it has ended. */
	readonly error: string | null;
	/** The error that stopped the case; null when none did. */
	readonly thrown: string | null;
	/** Notes made outside the steps, such as one after the run ended. */
	readonly notes: readonly string[];
}

interface Building {
	step: number;
	before: JsonObject | null;
	questions: FrameQuestion[];
	pick: number | null;
	answered: boolean;
	after: JsonObject | null;
	notes: string[];
}

type Entry<T extends TraceEntry["type"]> = Extract<TraceEntry, { type: T }>;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** What the question's facts say about the choice under `label`: its key and its own facts, as a pick writes them. */
function factsOf(question: Question, label: string): { key: string; data: unknown } {
	const choices = isObject(question.data) ? question.data["choices"] : undefined;
	const facts = isObject(choices) ? choices[label] : undefined;
	if (!isObject(facts)) return { key: label, data: undefined };
	return { key: typeof facts["key"] === "string" ? facts["key"] : label, data: facts["data"] };
}

/** A question of a step, before its answer: a choice question with its choices. */
function frameQuestion(id: string, question: Question): FrameQuestion {
	const cut = isObject(question.data) && typeof question.data["cut"] === "number" ? question.data["cut"] : 0;
	if (question.type !== "choice") return { id, question, answer: null, choices: [], cut };
	const choices = Object.entries(question.criteria).map(([label, text]) => ({
		label,
		text,
		probability: null,
		picked: false,
		...factsOf(question, label),
	}));
	return { id, question, answer: null, choices, cut };
}

/** A question with its answer: a choice answer gives each choice its probability and marks the picked one. */
function withAnswer(question: FrameQuestion, answer: Answer | undefined): FrameQuestion {
	if (answer === undefined) return question;
	if (answer.type !== "choice") return { ...question, answer };
	const choices = question.choices.map((choice) => ({
		...choice,
		probability: answer.probabilities[choice.label] ?? null,
		picked: choice.label === answer.choice,
	}));
	return { ...question, answer, choices };
}

/** The place of a step's pick among its questions: switch's pick question, or else the first choice question. */
function pickAmong(questions: readonly FrameQuestion[]): number | null {
	const named = questions.findIndex((question) => question.id === PICK_ID);
	const first = questions.findIndex((question) => question.question.type === "choice");
	const found = named >= 0 ? named : first;
	return found >= 0 ? found : null;
}

function questionsFrame(entry: Entry<"questions">, before: JsonObject | null): Building {
	const questions = Object.entries(entry.questions).map(([id, question]) => frameQuestion(id, question));
	return { step: entry.step, before, questions, pick: pickAmong(questions), answered: false, after: null, notes: [] };
}

interface Reading {
	initial: JsonObject | null;
	readonly frames: Building[];
	readonly notes: string[];
	last: JsonObject | null;
	ended: Ending | null;
	error: string | null;
	thrown: string | null;
}

function stated(reading: Reading, entry: Entry<"state">): void {
	const frame = reading.frames.at(-1);
	if (entry.step === 0) reading.initial = entry.state;
	else if (frame !== undefined) frame.after = entry.state;
	reading.last = entry.state;
}

function answered(reading: Reading, entry: Entry<"answers">): void {
	const frame = reading.frames.at(-1);
	if (frame === undefined) return;
	const answers: Answers = entry.answers;
	frame.questions = frame.questions.map((question) => withAnswer(question, answers[question.id]));
	frame.answered = true;
}

/** A note belongs to the step that is still waiting for its answers; any other note belongs to the story. */
function noted(reading: Reading, entry: Entry<"note">): void {
	const frame = reading.frames.at(-1);
	if (reading.ended === null && frame !== undefined && !frame.answered) frame.notes.push(entry.message);
	else reading.notes.push(entry.message);
}

/** How each type of entry adds to the story; the start adds nothing. */
const READERS: { readonly [T in TraceEntry["type"]]: (reading: Reading, entry: Entry<T>) => void } = {
	start: () => undefined,
	state: stated,
	questions: (reading, entry) => {
		reading.frames.push(questionsFrame(entry, reading.last));
	},
	answers: answered,
	ended: (reading, entry) => {
		reading.ended = entry.ended;
		reading.error = entry.error;
	},
	note: noted,
	thrown: (reading, entry) => {
		reading.thrown = entry.error;
	},
};

function read(reading: Reading, entry: TraceEntry): void {
	// The table gives each type its reader; TypeScript cannot tie the reader's entry type to the entry's.
	(READERS[entry.type] as (reading: Reading, entry: TraceEntry) => void)(reading, entry);
}

/** Reads the trace of the case named `name` into its initial state, one frame per step, and its end. */
export function storyOf(entries: readonly TraceEntry[], name: string): Story {
	const head = startOf(entries);
	const reading: Reading = {
		initial: null,
		frames: [],
		notes: [],
		last: null,
		ended: null,
		error: null,
		thrown: null,
	};
	for (const entry of entries) read(reading, entry);
	const { initial, frames, notes, last, ended, error, thrown } = reading;
	const { domain, model } = head;
	return { case: name, domain, model, initial, frames, last, ended, error, thrown, notes };
}

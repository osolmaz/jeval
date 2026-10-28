import { type Answer, type Ending, type JsonObject, startOf, type TraceEntry } from "@osolmaz/switch";

/** One choice that the model saw, with the probability it gave it; null when the model never answered. */
export interface FrameChoice {
	readonly key: string;
	readonly text: string;
	readonly probability: number | null;
	readonly picked: boolean;
	readonly data: unknown;
}

/** One step of a case: the state the model picked in, the choices it saw, its pick, and the state after it. */
export interface Frame {
	readonly step: number;
	/** The state before the pick. */
	readonly before: JsonObject | null;
	readonly choices: readonly FrameChoice[];
	/** How many of the choice function's choices the limit cut, so the model never saw them. */
	readonly cut: number;
	/** The picked choice's key; null when the pick failed. */
	readonly picked: string | null;
	/** The state after the transition; null after stop or a failed pick. */
	readonly after: JsonObject | null;
	readonly notes: readonly string[];
}

/** A case's trace, read for viewing. */
export interface Story {
	/** The case's name, from the folder that holds the trace. */
	readonly case: string;
	readonly domain: string;
	readonly model: string;
	/** The state before the first pick; null until the trace has it. */
	readonly initial: JsonObject | null;
	readonly frames: readonly Frame[];
	/** The latest state of the case. */
	readonly last: JsonObject | null;
	readonly answers: Readonly<Record<string, Answer>> | null;
	/** Why the steps ended; null until they have ended. */
	readonly ended: Ending | null;
	/** Why the answers failed; null when they did not, or until the answers are in. */
	readonly error: string | null;
	/** The error that stopped the case; null when none did. */
	readonly thrown: string | null;
	/** Notes made outside the steps, such as a retry of the answers. */
	readonly notes: readonly string[];
}

interface Building {
	step: number;
	before: JsonObject | null;
	choices: FrameChoice[];
	cut: number;
	picked: string | null;
	after: JsonObject | null;
	notes: string[];
}

type Entry<T extends TraceEntry["type"]> = Extract<TraceEntry, { type: T }>;

function withPick(frame: Building, pick: Entry<"pick">): void {
	frame.picked = pick.choice;
	frame.choices = frame.choices.map((offered) => ({
		...offered,
		probability: pick.probabilities[offered.key] ?? null,
		picked: offered.key === pick.choice,
	}));
}

function choicesFrame(entry: Entry<"choices">, before: JsonObject | null): Building {
	const choices = entry.choices.map((choice) => ({
		key: choice.key,
		text: choice.text,
		probability: null,
		picked: false,
		data: choice.data,
	}));
	return { step: entry.step, before, choices, cut: entry.cut ?? 0, picked: null, after: null, notes: [] };
}

interface Reading {
	initial: JsonObject | null;
	readonly frames: Building[];
	readonly notes: string[];
	last: JsonObject | null;
	answers: Readonly<Record<string, Answer>> | null;
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

function picked(reading: Reading, entry: Entry<"pick">): void {
	const frame = reading.frames.at(-1);
	if (frame !== undefined) withPick(frame, entry);
}

/** A note belongs to the step that is still waiting for its pick; any other note, such as one after the steps ended, belongs to the story. */
function noted(reading: Reading, entry: Entry<"note">): void {
	const frame = reading.frames.at(-1);
	if (reading.ended === null && frame?.picked === null && frame.after === null) frame.notes.push(entry.message);
	else reading.notes.push(entry.message);
}

/** How each type of entry adds to the story; the start and the answer stages add nothing. */
const READERS: { readonly [T in TraceEntry["type"]]: (reading: Reading, entry: Entry<T>) => void } = {
	start: () => undefined,
	state: stated,
	choices: (reading, entry) => {
		reading.frames.push(choicesFrame(entry, reading.last));
	},
	pick: picked,
	ended: (reading, entry) => {
		reading.ended = entry.ended;
	},
	stage: () => undefined,
	answers: (reading, entry) => {
		reading.answers = entry.answers;
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

/** Reads the trace of the case named `name` into its initial state, one frame per step, its answers and its end. */
export function storyOf(entries: readonly TraceEntry[], name: string): Story {
	const head = startOf(entries);
	const reading: Reading = {
		initial: null,
		frames: [],
		notes: [],
		last: null,
		answers: null,
		ended: null,
		error: null,
		thrown: null,
	};
	for (const entry of entries) read(reading, entry);
	const { initial, frames, notes, last, answers, ended, error, thrown } = reading;
	const { domain, model } = head;
	return { case: name, domain, model, initial, frames, last, answers, ended, error, thrown, notes };
}

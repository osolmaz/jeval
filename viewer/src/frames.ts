import type { Answer, JsonObject, TraceEntry } from "@osolmaz/switch";

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
	/** Notes made outside a step, such as a failed answer. */
	readonly notes: readonly string[];
}

interface Building {
	step: number;
	before: JsonObject | null;
	choices: FrameChoice[];
	picked: string | null;
	after: JsonObject | null;
	notes: string[];
}

type Entry<T extends TraceEntry["type"]> = Extract<TraceEntry, { type: T }>;

function withPick(frame: Building, pick: Entry<"pick">): void {
	frame.picked = pick.key;
	frame.choices = frame.choices.map((offered) => ({
		...offered,
		probability: pick.probabilities[offered.key] ?? null,
		picked: offered.key === pick.key,
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
	return { step: entry.step, before, choices, picked: null, after: null, notes: [] };
}

interface Reading {
	initial: JsonObject | null;
	readonly frames: Building[];
	readonly notes: string[];
	last: JsonObject | null;
	answers: Readonly<Record<string, Answer>> | null;
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

function noted(reading: Reading, entry: Entry<"note">): void {
	(reading.frames.at(-1)?.notes ?? reading.notes).push(entry.message);
}

function read(reading: Reading, entry: TraceEntry): void {
	switch (entry.type) {
		case "state":
			stated(reading, entry);
			return;
		case "choices":
			reading.frames.push(choicesFrame(entry, reading.last));
			return;
		case "pick":
			picked(reading, entry);
			return;
		case "note":
			noted(reading, entry);
			return;
		case "answers":
			reading.answers = entry.answers;
			return;
		case "start":
		case "stage":
			return;
	}
}

/** Reads the trace of the case named `name` into its initial state, one frame per step, and its answers. */
export function storyOf(entries: readonly TraceEntry[], name: string): Story {
	const head = entries[0];
	if (head?.type !== "start") throw new Error("a trace starts with its start entry");
	const reading: Reading = { initial: null, frames: [], notes: [], last: null, answers: null };
	for (const entry of entries) read(reading, entry);
	const { initial, frames, notes, last, answers } = reading;
	return { case: name, domain: head.domain, model: head.model, initial, frames, last, answers, notes };
}

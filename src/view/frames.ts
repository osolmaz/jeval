import type { Answer, TraceEntry } from "../core/index.ts";

/** One observation as the viewer shows it. */
export interface Seen {
	readonly source: string;
	readonly text: string;
	readonly data: unknown;
}

/** One option of a menu, with the probability the model gave it; null when the model never answered. */
export interface FrameOption {
	readonly key: string;
	readonly text: string;
	readonly probability: number | null;
	readonly chosen: boolean;
	readonly data: unknown;
}

/** One step of a case: what the model had seen, the menu it chose from, its choice, and what the step found. */
export interface Frame {
	readonly step: number;
	/** The latest observation before the menu: what the model chose in. */
	readonly before: Seen | null;
	readonly options: readonly FrameOption[];
	/** The chosen option's key; null when the choice failed. */
	readonly chosen: string | null;
	/** What the chosen step found; null after the stop option or a failed choice. */
	readonly after: Seen | null;
	readonly notes: readonly string[];
}

/** A case's trace, read for viewing. */
export interface Story {
	readonly case: string;
	readonly domain: string;
	readonly model: string;
	/** The observations every case starts with, made before the first choice. */
	readonly opening: readonly Seen[];
	readonly frames: readonly Frame[];
	/** The latest observation of the case. */
	readonly last: Seen | null;
	readonly answers: Readonly<Record<string, Answer>> | null;
	/** Notes made outside a step, such as a failed answer. */
	readonly notes: readonly string[];
}

interface Building {
	step: number;
	before: Seen | null;
	options: FrameOption[];
	chosen: string | null;
	after: Seen | null;
	notes: string[];
}

type Entry<T extends TraceEntry["type"]> = Extract<TraceEntry, { type: T }>;

function withChoice(frame: Building, choice: Entry<"choice">): void {
	frame.chosen = choice.key;
	frame.options = frame.options.map((option) => ({
		...option,
		probability: choice.probabilities[option.key] ?? null,
		chosen: option.key === choice.key,
	}));
}

function menuFrame(menu: Entry<"menu">, before: Seen | null): Building {
	const options = menu.options.map((option) => ({
		key: option.key,
		text: option.text,
		probability: null,
		chosen: false,
		data: option.data,
	}));
	return { step: menu.step, before, options, chosen: null, after: null, notes: [] };
}

interface Reading {
	readonly opening: Seen[];
	readonly frames: Building[];
	readonly notes: string[];
	last: Seen | null;
	answers: Readonly<Record<string, Answer>> | null;
}

function observed(reading: Reading, entry: Entry<"observation">): void {
	const seen = { source: entry.source, text: entry.text, data: entry.data };
	const frame = reading.frames.at(-1);
	if (frame === undefined || entry.step === 0) reading.opening.push(seen);
	else frame.after = seen;
	reading.last = seen;
}

function chose(reading: Reading, entry: Entry<"choice">): void {
	const frame = reading.frames.at(-1);
	if (frame !== undefined) withChoice(frame, entry);
}

function noted(reading: Reading, entry: Entry<"note">): void {
	(reading.frames.at(-1)?.notes ?? reading.notes).push(entry.message);
}

function read(reading: Reading, entry: TraceEntry): void {
	switch (entry.type) {
		case "observation":
			observed(reading, entry);
			return;
		case "menu":
			reading.frames.push(menuFrame(entry, reading.last));
			return;
		case "choice":
			chose(reading, entry);
			return;
		case "note":
			noted(reading, entry);
			return;
		case "answers":
			reading.answers = entry.answers;
			return;
		case "case":
		case "asked":
			return;
	}
}

/** Reads a case's trace into its opening, one frame per step, and its answers. */
export function storyOf(entries: readonly TraceEntry[]): Story {
	const head = entries[0];
	if (head?.type !== "case") throw new Error("a trace starts with its case entry");
	const reading: Reading = { opening: [], frames: [], notes: [], last: null, answers: null };
	for (const entry of entries) read(reading, entry);
	const { opening, frames, notes, last, answers } = reading;
	return { case: head.case, domain: head.domain, model: head.model, opening, frames, last, answers, notes };
}

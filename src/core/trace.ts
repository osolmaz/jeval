import { z } from "zod";
import type { Answer, Limits, MenuItem, Observation, Usage } from "./types.ts";

const usage = z.object({ inputTokens: z.number().nullable(), milliseconds: z.number() });
export const answerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("bool"), probability: z.number() }),
	z.object({ kind: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number()) }),
	z.object({ kind: z.literal("score"), score: z.number(), confidence: z.number() }),
]);
const base = { id: z.number().int(), parent: z.number().int().nullable() };

/** One line of a trace. Every entry names its parent, so a trace is a tree: a fork shares the steps before it. */
export const traceEntrySchema = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("case"),
		case: z.string(),
		domain: z.string(),
		version: z.string(),
		model: z.string(),
		limits: z.object({ steps: z.number(), options: z.number(), windowShare: z.number() }),
	}),
	z.object({
		...base,
		type: z.literal("observation"),
		step: z.number().int(),
		action: z.string(),
		key: z.string(),
		source: z.string(),
		text: z.string(),
		images: z.array(z.string()),
	}),
	z.object({
		...base,
		type: z.literal("menu"),
		step: z.number().int(),
		options: z.array(
			z.object({ key: z.string(), action: z.string(), text: z.string(), informs: z.array(z.string()) }),
		),
	}),
	z.object({
		...base,
		type: z.literal("choice"),
		step: z.number().int(),
		key: z.string(),
		probabilities: z.record(z.string(), z.number()),
		usage,
	}),
	z.object({
		...base,
		type: z.literal("answers"),
		answers: z.record(z.string(), answerSchema),
		usage: z.array(usage),
	}),
	z.object({
		...base,
		type: z.literal("asked"),
		stage: z.string(),
		answers: z.record(z.string(), answerSchema),
		usage: z.array(usage),
	}),
	z.object({ ...base, type: z.literal("note"), message: z.string() }),
]);

export type TraceEntry = z.infer<typeof traceEntrySchema>;
type Body<T extends TraceEntry["type"]> = Omit<Extract<TraceEntry, { type: T }>, "id" | "parent" | "type">;
/** A trace entry without the fields the trace assigns. */
type Unplaced = TraceEntry extends infer E ? (E extends TraceEntry ? Omit<E, "id" | "parent"> : never) : never;

/** The key of the stop option in traces. */
export const STOP_KEY = "stop";

/** Records a run as a chain of entries; `onEntry` sees each one as it is written, for streaming to a file. */
export class Trace {
	readonly entries: TraceEntry[] = [];
	private readonly onEntry: ((entry: TraceEntry) => void) | undefined;

	constructor(onEntry?: (entry: TraceEntry) => void) {
		this.onEntry = onEntry;
	}

	caseStarted(body: Body<"case">): void {
		this.push({ type: "case", ...body });
	}

	observed(step: number, action: string, key: string, observation: Observation): void {
		const images = (observation.images ?? []).map((image) => image.label);
		this.push({ type: "observation", step, action, key, source: observation.source, text: observation.text, images });
	}

	menu(step: number, items: readonly MenuItem[], stop: string): void {
		const options = items.map(({ key, action, text, informs }) => ({ key, action, text, informs: [...informs] }));
		options.push({ key: STOP_KEY, action: STOP_KEY, text: stop, informs: [] });
		this.push({ type: "menu", step, options });
	}

	chose(step: number, key: string, probabilities: Readonly<Record<string, number>>, used: Usage): void {
		this.push({ type: "choice", step, key, probabilities: { ...probabilities }, usage: used });
	}

	answered(answers: Readonly<Record<string, Answer>>, used: readonly Usage[]): void {
		this.push({ type: "answers", answers: { ...answers }, usage: [...used] });
	}

	asked(stage: string, answers: Readonly<Record<string, Answer>>, used: readonly Usage[]): void {
		this.push({ type: "asked", stage, answers: { ...answers }, usage: [...used] });
	}

	note(message: string): void {
		this.push({ type: "note", message });
	}

	private push(body: Unplaced): void {
		const last = this.entries.at(-1);
		const entry = traceEntrySchema.parse({ ...body, id: this.entries.length, parent: last?.id ?? null });
		this.entries.push(entry);
		this.onEntry?.(entry);
	}
}

/** Reads a trace from JSON Lines text, checking every entry. */
export function parseTrace(text: string): TraceEntry[] {
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => traceEntrySchema.parse(JSON.parse(line)));
}

export function limitsOf(entries: readonly TraceEntry[]): Limits {
	const first = entries[0];
	if (first?.type !== "case") throw new Error("a trace starts with its case entry");
	return first.limits;
}

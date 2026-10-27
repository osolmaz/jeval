import { z } from "zod";
import type { Answer, Choice, Json, Limits, Observation, Usage } from "./types.ts";

const usage = z.object({ inputTokens: z.number().nullable(), milliseconds: z.number() });
export const answerSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("bool"), probability: z.number() }),
	z.object({
		type: z.literal("choice"),
		choice: z.string(),
		probabilities: z.record(z.string(), z.number()),
		confidence: z.number().optional(),
	}),
	z.object({ type: z.literal("score"), score: z.number(), confidence: z.number() }),
]);
const base = { id: z.number().int(), parent: z.number().int().nullable() };
/** A JSON value, as the core types it. */
const json: z.ZodType<Json> = z.json();
/** Facts for tools that read the trace, written only when there are any; a replay gives them back to the domain. */
const data = z.record(z.string(), json).optional();

/** One line of a trace. Every entry names its parent, so a trace is a tree: a fork shares the steps before it. */
export const traceEntrySchema = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("case"),
		case: z.string(),
		domain: z.string(),
		version: z.string(),
		model: z.string(),
		limits: z.object({ steps: z.number(), choices: z.number(), windowShare: z.number() }),
	}),
	z.object({
		...base,
		type: z.literal("observation"),
		step: z.number().int(),
		kind: z.string(),
		key: z.string(),
		source: z.string().optional(),
		text: z.string(),
		images: z.array(z.string()),
		data,
	}),
	z.object({
		...base,
		type: z.literal("menu"),
		step: z.number().int(),
		choices: z.array(z.object({ key: z.string(), kind: z.string(), text: z.string(), data })),
	}),
	z.object({
		...base,
		type: z.literal("choice"),
		step: z.number().int(),
		key: z.string(),
		probabilities: z.record(z.string(), z.number()),
		confidence: z.number().optional(),
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

/** The key and the kind of the stop choice in traces. */
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

	observed(step: number, kind: string, key: string, observation: Observation): void {
		const images = (observation.images ?? []).map((image) => image.label);
		const { source, text } = observation;
		const named = source === undefined ? {} : { source };
		const facts = observation.data === undefined ? {} : { data: observation.data };
		this.push({ type: "observation", step, kind, key, ...named, text, images, ...facts });
	}

	menu(step: number, menu: readonly Choice[], stop: string): void {
		const choices = menu.map(({ key, kind, text, data }) => ({
			key,
			kind,
			text,
			...(data === undefined ? {} : { data }),
		}));
		choices.push({ key: STOP_KEY, kind: STOP_KEY, text: stop });
		this.push({ type: "menu", step, choices });
	}

	/** Records the model's choice: its key, the probabilities by key, the model's confidence and the usage. */
	chose(
		step: number,
		chosen: {
			readonly key: string;
			readonly probabilities: Readonly<Record<string, number>>;
			readonly confidence: number | undefined;
			readonly usage: Usage;
		},
	): void {
		const { key, probabilities, confidence } = chosen;
		const sure = confidence === undefined ? {} : { confidence };
		this.push({ type: "choice", step, key, probabilities: { ...probabilities }, ...sure, usage: chosen.usage });
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

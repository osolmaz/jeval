import { z } from "zod";
import type { Answer, Choice, Json, JsonObject, Limits, Usage } from "./types.ts";

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
const jsonObject = z.record(z.string(), json);
/** Facts for tools that read the trace, written only when there are any. */
const data = jsonObject.optional();

/** One line of a trace. Every entry names its parent, so a trace is a tree: a fork shares the steps before it. */
export const traceEntrySchema = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("start"),
		domain: z.string(),
		version: z.string(),
		model: z.string(),
		limits: z.object({ steps: z.number(), choices: z.number(), windowShare: z.number() }),
	}),
	z.object({ ...base, type: z.literal("state"), step: z.number().int(), state: jsonObject }),
	z.object({
		...base,
		type: z.literal("choices"),
		step: z.number().int(),
		choices: z.array(z.object({ key: z.string(), type: z.string(), text: z.string(), data })),
	}),
	z.object({
		...base,
		type: z.literal("pick"),
		step: z.number().int(),
		key: z.string(),
		probabilities: z.record(z.string(), z.number()),
		confidence: z.number().optional(),
		usage,
	}),
	z.object({
		...base,
		type: z.literal("stage"),
		stage: z.string(),
		answers: z.record(z.string(), answerSchema),
		usage: z.array(usage),
	}),
	z.object({
		...base,
		type: z.literal("answers"),
		answers: z.record(z.string(), answerSchema),
		usage: z.array(usage),
	}),
	z.object({ ...base, type: z.literal("note"), message: z.string() }),
]);

export type TraceEntry = z.infer<typeof traceEntrySchema>;
type Body<T extends TraceEntry["type"]> = Omit<Extract<TraceEntry, { type: T }>, "id" | "parent" | "type">;
/** A trace entry without the fields the trace assigns. */
type Unplaced = TraceEntry extends infer E ? (E extends TraceEntry ? Omit<E, "id" | "parent"> : never) : never;

/** The key and the type of the stop choice in traces. */
export const STOP_KEY = "stop";

/** Records a run as a chain of entries; `onEntry` sees each one as it is written, for streaming to a file. */
export class Trace {
	readonly entries: TraceEntry[] = [];
	private readonly onEntry: ((entry: TraceEntry) => void) | undefined;

	constructor(onEntry?: (entry: TraceEntry) => void) {
		this.onEntry = onEntry;
	}

	started(body: Body<"start">): void {
		this.push({ type: "start", ...body });
	}

	/** Records the state after `step` steps: the initial state at step 0. */
	state(step: number, state: JsonObject): void {
		this.push({ type: "state", step, state });
	}

	/** Records the choices that the model sees at `step`, and the stop choice after them. */
	choices(step: number, offered: readonly Choice[], stop: string): void {
		const choices = offered.map(({ key, type, text, data }) => ({
			key,
			type,
			text,
			...(data === undefined ? {} : { data }),
		}));
		choices.push({ key: STOP_KEY, type: STOP_KEY, text: stop });
		this.push({ type: "choices", step, choices });
	}

	/** Records the model's pick: its key, the probabilities by key, the model's confidence and the usage. */
	picked(
		step: number,
		pick: {
			readonly key: string;
			readonly probabilities: Readonly<Record<string, number>>;
			readonly confidence: number | undefined;
			readonly usage: Usage;
		},
	): void {
		const { key, probabilities, confidence } = pick;
		const sure = confidence === undefined ? {} : { confidence };
		this.push({ type: "pick", step, key, probabilities: { ...probabilities }, ...sure, usage: pick.usage });
	}

	/** Records the answers of one stage of a domain's own answer function. */
	stage(stage: string, answers: Readonly<Record<string, Answer>>, used: readonly Usage[]): void {
		this.push({ type: "stage", stage, answers: { ...answers }, usage: [...used] });
	}

	/** Records the final answer to each question. */
	answered(answers: Readonly<Record<string, Answer>>, used: readonly Usage[]): void {
		this.push({ type: "answers", answers: { ...answers }, usage: [...used] });
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

/** The first entry of a trace, which says what ran. */
export function startOf(entries: readonly TraceEntry[]): Extract<TraceEntry, { type: "start" }> {
	const first = entries[0];
	if (first?.type !== "start") throw new Error("a trace starts with its start entry");
	return first;
}

export const limitsOf = (entries: readonly TraceEntry[]): Limits => startOf(entries).limits;

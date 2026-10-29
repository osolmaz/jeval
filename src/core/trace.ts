import { z } from "zod";
import type { Answers, Ending, Json, JsonObject, Questions } from "./types.ts";

/** A JSON value, as the core types it. */
const json: z.ZodType<Json> = z.json();
const jsonObject = z.record(z.string(), json);
const text = z.string();
/** switch's own facts about a question, which the model never sees. */
const data = jsonObject.optional();

export const questionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("bool"), instructions: text, criteria: z.object({ true: text, false: text }), data }),
	z.object({ type: z.literal("choice"), instructions: text, criteria: z.record(z.string(), text), data }),
	z.object({ type: z.literal("score"), instructions: text, criteria: z.array(text).readonly(), data }),
]);
const questions = z.record(z.string(), questionSchema);
export const answerSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("bool"), probability: z.number() }),
	z.object({
		type: z.literal("choice"),
		choice: z.string(),
		probabilities: z.record(z.string(), z.number()),
		confidence: z.number(),
	}),
	z.object({ type: z.literal("score"), score: z.number(), confidence: z.number() }),
]);
const answers = z.record(z.string(), answerSchema);
export const endingSchema = z.enum(["done", "step limit", "failed"]);
export const limitsSchema = z.object({
	steps: z.number().int().positive().optional(),
	windowShare: z.number().positive().max(1),
});

/**
 * One line of a trace, in the order the run wrote them. The usage of each request is in the run's requests file, which
 * keeps every request once.
 */
const traceEntrySchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("start"),
		domain: z.string(),
		version: z.string(),
		/** The hash of the domain's definition. */
		definition: z.string(),
		/** The case's id; null when the run was given none. */
		case: z.string().nullable(),
		model: z.string(),
		limits: limitsSchema,
	}),
	z.object({ type: z.literal("state"), step: z.number().int(), state: jsonObject }),
	/** The questions of a step, written before the model is asked. */
	z.object({ type: z.literal("questions"), step: z.number().int(), questions }),
	z.object({
		type: z.literal("answers"),
		step: z.number().int(),
		answers,
		/** The answers were taken from a recorded trace, and the model was not asked. */
		repeated: z.literal(true).optional(),
	}),
	/** Why the run ended, how many steps it took and why it failed: the last entry of a run. */
	z.object({ type: z.literal("ended"), ended: endingSchema, steps: z.number().int(), error: z.string().nullable() }),
	z.object({ type: z.literal("note"), message: z.string() }),
	/** The case failed: its code, or switch, threw this error, and the run stopped there. */
	z.object({ type: z.literal("thrown"), error: z.string() }),
]);

export type TraceEntry = z.infer<typeof traceEntrySchema>;
type Body<T extends TraceEntry["type"]> = Omit<Extract<TraceEntry, { type: T }>, "type">;

/** Records a run as a list of entries; `onEntry` sees each one as it is written, for streaming to a file. */
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

	/** Records the questions of `step`, with switch's own facts about them. */
	questions(step: number, asked: Questions): void {
		this.push({ type: "questions", step, questions: { ...asked } });
	}

	/** Records the answers of `step`; `repeated` when they came from a recorded trace. */
	answered(step: number, given: Answers, repeated: boolean): void {
		this.push({ type: "answers", step, answers: { ...given }, ...(repeated ? { repeated: true as const } : {}) });
	}

	/** Records why the run ended, how many steps it took, and why it failed. */
	ended(ended: Ending, steps: number, error: string | null): void {
		this.push({ type: "ended", ended, steps, error });
	}

	note(message: string): void {
		this.push({ type: "note", message });
	}

	/** Records the error that stopped the case. */
	thrown(error: string): void {
		this.push({ type: "thrown", error });
	}

	private push(entry: TraceEntry): void {
		const checked = traceEntrySchema.parse(entry);
		this.entries.push(checked);
		this.onEntry?.(checked);
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

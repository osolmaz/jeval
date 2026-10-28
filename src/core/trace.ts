import { z } from "zod";
import type { Answers, Choice, Ending, Json, JsonObject } from "./types.ts";

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
export const endingSchema = z.enum(["stop", "no choices", "step limit", "pick failed"]);
/** A JSON value, as the core types it. */
const json: z.ZodType<Json> = z.json();
const jsonObject = z.record(z.string(), json);
/** Facts for tools that read the trace, written only when there are any. */
const data = jsonObject.optional();

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
		limits: z.object({ steps: z.number(), choices: z.number(), windowShare: z.number() }),
	}),
	z.object({ type: z.literal("state"), step: z.number().int(), state: jsonObject }),
	z.object({
		type: z.literal("choices"),
		step: z.number().int(),
		choices: z.array(z.object({ key: z.string(), type: z.string(), text: z.string(), data })),
		/** How many of the choice function's choices the limit cut, written only when it cut any. */
		cut: z.number().int().positive().optional(),
	}),
	z.object({
		type: z.literal("pick"),
		step: z.number().int(),
		/** The key of the picked choice, or stop. */
		choice: z.string(),
		/** The probability of each choice, by key. */
		probabilities: z.record(z.string(), z.number()),
		confidence: z.number(),
		/** The pick was taken from a recorded trace, and the model was not asked. */
		repeated: z.literal(true).optional(),
	}),
	/** Why the steps ended, and how many there were, before the answers. */
	z.object({ type: z.literal("ended"), ended: endingSchema, steps: z.number().int() }),
	z.object({ type: z.literal("stage"), stage: z.string(), answers }),
	/** The final answer to each question, or why the answers failed: the last entry of a run. */
	z.object({ type: z.literal("answers"), answers: answers.nullable(), error: z.string().nullable() }),
	z.object({ type: z.literal("note"), message: z.string() }),
	/** The case failed: its code, or switch, threw this error, and the run stopped there. */
	z.object({ type: z.literal("thrown"), error: z.string() }),
]);

export type TraceEntry = z.infer<typeof traceEntrySchema>;
type Body<T extends TraceEntry["type"]> = Omit<Extract<TraceEntry, { type: T }>, "type">;

/** The key and the type of the stop choice in traces. */
export const STOP_KEY = "stop";

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

	/** Records the choices that the model sees at `step`, the stop choice after them, and how many the limit cut. */
	choices(step: number, offered: readonly Choice[], stop: string, cut: number): void {
		const choices = offered.map(({ key, type, text, data }) => ({
			key,
			type,
			text,
			...(data === undefined ? {} : { data }),
		}));
		choices.push({ key: STOP_KEY, type: STOP_KEY, text: stop });
		this.push({ type: "choices", step, choices, ...(cut > 0 ? { cut } : {}) });
	}

	/** Records the pick at `step`: the picked choice's key, the probabilities by key, and the model's confidence. */
	picked(step: number, pick: Omit<Body<"pick">, "step">): void {
		this.push({ type: "pick", step, ...pick, probabilities: { ...pick.probabilities } });
	}

	/** Records why the steps ended, and how many there were. */
	ended(ended: Ending, steps: number): void {
		this.push({ type: "ended", ended, steps });
	}

	/** Records the answers of one stage of a domain's own answer function. */
	stage(stage: string, answers: Answers): void {
		this.push({ type: "stage", stage, answers: { ...answers } });
	}

	/** Records the final answer to each question, or, with no answers, why they failed. */
	answered(answers: Answers | null, error: string | null): void {
		this.push({ type: "answers", answers: answers === null ? null : { ...answers }, error });
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

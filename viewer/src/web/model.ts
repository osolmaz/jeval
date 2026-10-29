import type { Answer, JsonObject } from "@osolmaz/switch";
import type { Frame, FrameChoice, FrameQuestion, Story } from "../frames.ts";

/**
 * What the viewer works from, in the browser and in tests: no DOM here. A session is a case's story with its outcome;
 * a domain's part of the page reads its own fields from each state.
 */
export interface Session {
	readonly story: Story;
	readonly outcome: Readonly<Record<string, unknown>> | null;
	/** The domain's short line on how the case ended; null when it gives none. */
	readonly summary: string | null;
	/** Whether the case has its result, so nothing more will come. */
	readonly finished: boolean;
	readonly version: string;
}

/** One moment of the timeline: the start, a step, or the end. */
export interface Moment {
	readonly type: "start" | "step" | "end";
	readonly label: string;
	/** The state the step asked in, or the latest state at the start and the end. */
	readonly state: JsonObject | null;
	readonly frame: Frame | null;
}

/** The start, each step, and the end once the case has finished; a running case ends at its newest step. */
export function momentsOf(story: Story, finished: boolean): Moment[] {
	const total = story.frames.length;
	const moments: Moment[] = [
		{ type: "start", label: "Start", state: story.initial, frame: null },
		...story.frames.map((frame) => ({
			type: "step" as const,
			label: finished ? `Step ${String(frame.step)} of ${String(total)}` : `Step ${String(frame.step)}`,
			state: frame.before,
			frame,
		})),
	];
	if (finished) moments.push({ type: "end", label: "End", state: story.last, frame: null });
	return moments;
}

export const percent = (probability: number | null): string =>
	probability === null ? "–" : `${(probability * 100).toFixed(probability < 0.001 ? 2 : 1)}%`;

/** The choices of a question, likeliest first. */
export const ranked = (choices: readonly FrameChoice[]): FrameChoice[] =>
	[...choices].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

/** The pick of a step: switch's pick question, or else its first choice question; null when it has neither. */
export const pickOf = (frame: Frame | null): FrameQuestion | null =>
	frame?.pick == null ? null : (frame.questions[frame.pick] ?? null);

export function answerText(answer: Answer): string {
	if (answer.type === "bool") return `yes ${percent(answer.probability)}`;
	if (answer.type === "choice") return `${answer.choice} ${percent(answer.probabilities[answer.choice] ?? null)}`;
	return `${answer.score.toFixed(2)} (confidence ${percent(answer.confidence)})`;
}

/** A value of a domain's outcome or state as text: lists and objects become comma-separated parts. */
export function plain(value: unknown): string {
	if (Array.isArray(value)) return value.map(plain).join(", ");
	if (typeof value === "object" && value !== null) {
		return Object.entries(value)
			.map(([key, inner]) => `${key} ${plain(inner)}`)
			.join(", ");
	}
	return typeof value === "string" ? value : JSON.stringify(value);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The entries that a list gained at its end, or null when it changed in another way. */
function grown(before: unknown, after: unknown): readonly unknown[] | null {
	if (!Array.isArray(before) || !Array.isArray(after) || after.length < before.length) return null;
	return before.every((entry, index) => same(entry, after[index])) ? after.slice(before.length) : null;
}

/** The lines of one field that changed: its new value, or, for a list that only grew, its new entries. */
function fieldChanges(field: string, old: unknown, value: unknown): string[] {
	if (old !== undefined && same(old, value)) return [];
	const added = grown(old, value);
	return added === null ? [`${field}: ${plain(value)}`] : added.map((entry) => `${field} + ${plain(entry)}`);
}

/** What a step changed in the state, one line for each change of a top-level field. */
export function changesOf(before: JsonObject | null, after: JsonObject): string[] {
	const changed = Object.entries(after).flatMap(([field, value]) => fieldChanges(field, before?.[field], value));
	const removed = Object.keys(before ?? {}).filter((field) => !(field in after));
	return [...changed, ...removed.map((field) => `${field}: removed`)];
}

/** The probability of each step's pick, step by step; null where a step has no pick, or where it failed. */
export const pickProbabilities = (story: Story): (number | null)[] =>
	story.frames.map((frame) => pickOf(frame)?.choices.find((choice) => choice.picked)?.probability ?? null);

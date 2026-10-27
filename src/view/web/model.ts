import type { Answer } from "../../core/types.ts";
import type { Frame, FrameChoice, Seen, Story } from "../frames.ts";

/**
 * What the viewer works from, in the browser and in tests: no DOM here. A session is a case's story with its outcome;
 * a domain's part of the page reads its own data from each step.
 */
export interface Session {
	readonly story: Story;
	readonly outcome: Readonly<Record<string, unknown>> | null;
	/** Whether the case has its result, so nothing more will come. */
	readonly finished: boolean;
	readonly version: string;
}

/** One view of the timeline: the start, a step's decision, or the end. */
export interface Moment {
	readonly kind: "start" | "step" | "end";
	readonly label: string;
	/** What the model chose in, or the latest state at the start and the end. */
	readonly seen: Seen | null;
	readonly frame: Frame | null;
}

/** The start, each step, and the end once the case has finished; a running case ends at its newest step. */
export function momentsOf(story: Story, finished: boolean): Moment[] {
	const total = story.frames.length;
	const moments: Moment[] = [
		{ kind: "start", label: "Start", seen: story.opening.at(-1) ?? null, frame: null },
		...story.frames.map((frame) => ({
			kind: "step" as const,
			label: finished ? `Step ${String(frame.step)} of ${String(total)}` : `Step ${String(frame.step)}`,
			seen: frame.before,
			frame,
		})),
	];
	if (finished) moments.push({ kind: "end", label: "End", seen: story.last, frame: null });
	return moments;
}

export const percent = (probability: number | null): string =>
	probability === null ? "–" : `${(probability * 100).toFixed(probability < 0.001 ? 2 : 1)}%`;

/** The choices of a step, likeliest first. */
export const ranked = (choices: readonly FrameChoice[]): FrameChoice[] =>
	[...choices].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

export function answerText(answer: Answer): string {
	if (answer.type === "bool") return `yes ${percent(answer.probability)}`;
	if (answer.type === "choice") return `${answer.choice} ${percent(answer.probabilities[answer.choice] ?? null)}`;
	return `${answer.score.toFixed(2)} (confidence ${percent(answer.confidence)})`;
}

/** A value of a domain's outcome as text: lists and objects become comma-separated parts. */
export function plain(value: unknown): string {
	if (Array.isArray(value)) return value.map(plain).join(", ");
	if (typeof value === "object" && value !== null) {
		return Object.entries(value)
			.map(([key, inner]) => `${key} ${plain(inner)}`)
			.join(", ");
	}
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** The model's probability for each choice it made, step by step; null where the choice failed. */
export const confidence = (story: Story): (number | null)[] =>
	story.frames.map((frame) => frame.choices.find((choice) => choice.chosen)?.probability ?? null);

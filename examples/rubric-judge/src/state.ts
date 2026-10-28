import { type Image, type JsonObject, typedKey } from "@osolmaz/switch";
import type { CaseFile, JudgeCase, Render } from "./case.ts";

/**
 * The types of choice. A choice's key is its type's name and its key within the type, as `typedKey` makes it, and the
 * evidence that the choice adds keeps that key, so that the choice is left out once it is done.
 */
export const TYPES = {
	read: "read",
	look: "look",
	search: "search",
	count: "count",
	changes: "changes",
	compare: "compare",
} as const;

/** Sizes in estimated tokens, at three characters a token. */
export const SIZES = {
	charsPerToken: 3,
	/** The answer's text read before the first choice. */
	answerTokens: 22_000,
	/** All evidence together. */
	evidenceTokens: 40_000,
	/** The largest part of a file that one step reads. */
	chunkTokens: 6_000,
	images: 6,
	searchChoices: 10,
	partChoices: 4,
	hits: 8,
	hitContext: 280,
} as const;

/** A case as its folder gives it: the case, and a way to load the images stored next to it. */
export interface CaseFolder {
	readonly case: JudgeCase;
	image(render: Render): Promise<Image>;
}

/** One thing the run found: the key of the choice that found it, where it came from, its text, and its image. */
export interface Evidence extends JsonObject {
	readonly key: string;
	readonly source: string;
	readonly text: string;
	/** The image the choice looked at, by its file next to the case; the view loads it. */
	readonly image?: Render;
}

/** Where a case is: the evidence found so far, in order. */
export interface JudgeState extends JsonObject {
	readonly evidence: readonly Evidence[];
}

/** The state with one more piece of evidence. */
export const withEvidence = (state: JudgeState, found: Evidence): JudgeState => ({
	evidence: [...state.evidence, found],
});

/** Whether the state holds the evidence of the choice with `key`. */
export const found = (state: JudgeState, key: string): boolean => state.evidence.some((entry) => entry.key === key);

export const tokensOf = (text: string): number => Math.ceil(text.length / SIZES.charsPerToken);

/** A run of consecutive parts of a file. */
export interface Part {
	readonly file: CaseFile;
	readonly from: number;
	readonly to: number;
}

export const partKey = (part: Part): string => `${part.file.id}:${String(part.from)}-${String(part.to)}`;

/** The parts of a file not yet read, grouped into runs of at most one chunk each. */
export function unreadParts(file: CaseFile, read: ReadonlySet<number>): (Part & { tokens: number })[] {
	const parts: (Part & { tokens: number })[] = [];
	let current: (Part & { tokens: number }) | null = null;
	file.units.forEach((unit, index) => {
		if (read.has(index) || unit.text.trim() === "") {
			current = null;
			return;
		}
		const tokens = tokensOf(unit.text);
		if (current === null || current.tokens + tokens > SIZES.chunkTokens) {
			current = { file, from: index, to: index, tokens };
			parts.push(current);
		} else {
			current = { ...current, to: index, tokens: current.tokens + tokens };
			parts[parts.length - 1] = current;
		}
	});
	return parts;
}

export const partWords = (part: Part): number =>
	part.file.units
		.slice(part.from, part.to + 1)
		.reduce((sum, unit) => sum + unit.text.split(/\s+/).filter(Boolean).length, 0);

export function partText(part: Part): string {
	const many = part.file.units.length > 1;
	return part.file.units
		.slice(part.from, part.to + 1)
		.map((unit) => (many ? `[${unit.label}]\n${unit.text}` : unit.text))
		.join("\n\n");
}

export function partSource(part: Part): string {
	const whole = part.from === 0 && part.to === part.file.units.length - 1;
	if (whole) return part.file.path;
	const first = part.file.units[part.from]?.label ?? "";
	const last = part.file.units[part.to]?.label ?? "";
	return part.from === part.to ? `${part.file.path}, ${first}` : `${part.file.path}, ${first} to ${last}`;
}

/** The file and the first and last unit that a read's key names, as `partKey` makes it; null for another type's key. */
function readRange(key: string): [file: string, from: number, to: number] | null {
	const prefix = typedKey(TYPES.read, "");
	const match = key.startsWith(prefix) ? /^(.+):(\d+)-(\d+)$/.exec(key.slice(prefix.length)) : null;
	if (match === null) return null;
	const [, file = "", from = "0", to = "0"] = match;
	return [file, Number(from), Number(to)];
}

/** The parts of each file read so far, from the keys of the state's `read` evidence. */
export function readParts(state: JudgeState): Map<string, Set<number>> {
	const read = new Map<string, Set<number>>();
	for (const entry of state.evidence) {
		const range = readRange(entry.key);
		if (range === null) continue;
		const [file, from, to] = range;
		const units = read.get(file) ?? new Set<number>();
		for (let index = from; index <= to; index += 1) units.add(index);
		read.set(file, units);
	}
	return read;
}

export const evidenceTokens = (state: JudgeState): number =>
	state.evidence.reduce((sum, entry) => sum + tokensOf(entry.text) + tokensOf(entry.source), 0);

export const imagesSeen = (state: JudgeState): number =>
	state.evidence.filter((entry) => entry.image !== undefined).length;

export const readable = (file: CaseFile): boolean =>
	file.error === null && file.format !== "image" && file.units.length > 0;

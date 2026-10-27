import type { Image, Step } from "@osolmaz/switch";
import type { CaseFile, LegalCase, Render } from "./case.ts";
import { searchTerms, type Term } from "./terms.ts";

/** Sizes in estimated tokens, at three characters a token. */
export const LIMITS = {
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

/** The world of a case: the case, with what the domain derives from it once, the search terms and a way to load images. */
export interface World {
	readonly case: LegalCase;
	readonly terms: readonly Term[];
	image(render: Render): Promise<Image>;
}

export function makeWorld(legalCase: LegalCase, loadImage: (render: Render) => Promise<Image>): World {
	return { case: legalCase, terms: searchTerms(legalCase), image: loadImage };
}

export const tokensOf = (text: string): number => Math.ceil(text.length / LIMITS.charsPerToken);

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
		if (current === null || current.tokens + tokens > LIMITS.chunkTokens) {
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

/** The parts of each file read so far, from the keys of the history's `read` steps. */
export function readParts(history: readonly Step[]): Map<string, Set<number>> {
	const read = new Map<string, Set<number>>();
	for (const step of history) {
		const match = /^read:(.+):(\d+)-(\d+)$/.exec(step.key);
		if (match === null) continue;
		const [, file = "", from = "0", to = "0"] = match;
		const units = read.get(file) ?? new Set<number>();
		for (let index = Number(from); index <= Number(to); index += 1) units.add(index);
		read.set(file, units);
	}
	return read;
}

export const evidenceTokens = (history: readonly Step[]): number =>
	history.reduce((sum, step) => sum + tokensOf(step.observation.text) + tokensOf(step.observation.source ?? ""), 0);

export const imagesSeen = (history: readonly Step[]): number =>
	history.reduce((sum, step) => sum + (step.observation.images?.length ?? 0), 0);

export const readable = (file: CaseFile): boolean =>
	file.error === null && file.kind !== "image" && file.units.length > 0;

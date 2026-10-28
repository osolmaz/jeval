/// <reference lib="dom" />
/** A domain's part of the page: the hooks with which a domain draws its own steps, and where the page finds them. */
import type { Moment, Session } from "./model.ts";

/** What a domain's part gets from the page. */
export interface PartContext {
	/** The part's config from the server, such as the images it draws with. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Milliseconds one motion in the drawing takes at the page's speed; 0 when the viewer asks for less motion. */
	motion(): number;
	/** Milliseconds between the motions of one step while the page plays; 0 when it does not play. */
	gap(): number;
}

/** A file that the page offers to download. */
export interface Download {
	readonly name: string;
	readonly type: string;
	readonly text: string;
}

/** A domain's part of the page. Every hook is optional: without one, the page shows its own plain parts. */
export interface DomainPart {
	/**
	 * The drawing of `moment` of `session`, moved to it from `from` when the page steps forward to it; null for the
	 * state as JSON. The part draws all of it, and anything it needs with it.
	 */
	draw?(moment: Moment, from: Moment | null, session: Session): Promise<HTMLElement | null>;
	/** Text after a step's label, which starts with its own separator. */
	stepNote?(moment: Moment): string;
	/** A list of the steps beside the drawing, with its title; each entry opens a moment. */
	readonly steps?: {
		readonly title: string;
		list(session: Session, index: number, open: (moment: number) => void): HTMLElement[];
	};
	/** Fields of the outcome that the result leaves out. */
	readonly hidden?: readonly string[];
	/** The download button's label and text, and the file it gives. */
	readonly download?: { readonly label: string; readonly text: string; file(session: Session): Download };
}

export type PartMaker = (context: PartContext) => DomainPart;

const PARTS = new Map<string, PartMaker>();

/** Registers a domain's part under the domain's name: the page uses it for that domain's cases. */
export function registerPart(domain: string, make: PartMaker): void {
	PARTS.set(domain, make);
}

/** The part of `domain`, or no part when the domain has none. */
export function partOf(domain: string, context: PartContext): DomainPart {
	return PARTS.get(domain)?.(context) ?? {};
}

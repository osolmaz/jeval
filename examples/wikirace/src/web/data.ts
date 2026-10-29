/**
 * What the wikirace part reads of a case: a race in each state, and the branches of each step's pick, which are links,
 * sections to open and giving up.
 */
import { type FrameChoice, type Moment, pickOf, ranked, type Session } from "@osolmaz/switch-viewer/page";

/** One article of the path, and the text of the link that led to it. */
export interface RaceVisit {
	readonly title: string;
	readonly via: string;
}

/** What the part reads of a race's state; anything else in it stays in the state's JSON. */
export interface RaceView {
	readonly target: string;
	readonly path: readonly RaceVisit[];
	/** The section whose links the state shows; null when it shows every link of the article. */
	readonly section: string | null;
	readonly gaveUp: boolean;
	/** What the last step did, in words. */
	readonly last: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const visitsOf = (path: readonly unknown[]): RaceVisit[] =>
	path.flatMap((visit) =>
		isRecord(visit) && typeof visit["title"] === "string"
			? [{ title: visit["title"], via: typeof visit["via"] === "string" ? visit["via"] : visit["title"] }]
			: [],
	);

/** The name of the section that a state shows; null when it shows every link. */
function openSection(state: Readonly<Record<string, unknown>>): string | null {
	const sections = Array.isArray(state["sections"]) ? state["sections"] : [];
	const open: unknown = typeof state["open"] === "number" ? sections[state["open"]] : null;
	return isRecord(open) && typeof open["name"] === "string" ? open["name"] : null;
}

/** The race of a moment's state; null when the state is not a race's. */
export function raceOf(state: unknown): RaceView | null {
	if (!isRecord(state) || typeof state["target"] !== "string" || !Array.isArray(state["path"])) return null;
	return {
		target: state["target"],
		path: visitsOf(state["path"]),
		section: openSection(state),
		gaveUp: state["gaveUp"] === true,
		last: typeof state["last"] === "string" ? state["last"] : "",
	};
}

/** Wikipedia titles match whatever the case of their first letter. */
export const sameArticle = (a: string, b: string): boolean =>
	a.charAt(0).toUpperCase() + a.slice(1) === b.charAt(0).toUpperCase() + b.slice(1);

/** The article the race is at. */
export const raceHere = (race: RaceView): string => race.path.at(-1)?.title ?? "";

export const raceReached = (race: RaceView): boolean => sameArticle(raceHere(race), race.target);

/** The hops between articles so far. */
export const raceHops = (race: RaceView): number => Math.max(0, race.path.length - 1);

/** One branch of a step's pick: a link to follow, a section to open, or giving up. */
export interface RaceBranch {
	/** The choice's type: "link", "section" or "give-up". */
	readonly type: string;
	/** The link's title, the section's name, or the text of giving up. */
	readonly name: string;
	/** For a section, how many links it has; null for the others. */
	readonly links: number | null;
	readonly probability: number | null;
	readonly picked: boolean;
}

/** What the part reads of one choice of a pick. */
export function raceBranch(choice: FrameChoice): RaceBranch {
	const { data } = choice;
	const section = choice.type === "section" && isRecord(data) && typeof data["section"] === "string";
	return {
		type: choice.type ?? "link",
		name: section ? (data["section"] as string) : choice.text,
		links: section && typeof data["links"] === "number" ? data["links"] : null,
		probability: choice.probability,
		picked: choice.picked,
	};
}

/** The branches of a step that the drawing shows, and how many choices of its pick it leaves out or the limit cut. */
export interface RaceFork {
	readonly shown: readonly RaceBranch[];
	readonly total: number;
	readonly cut: number;
	readonly answered: boolean;
}

/**
 * A step's likeliest branches, at most `count`, with the picked one always among them, or the first `count` in the
 * article's order before the model answered; null for a moment without a pick.
 */
export function raceFork(moment: Moment, count: number): RaceFork | null {
	const pick = pickOf(moment.frame);
	if (pick === null) return null;
	const all = ranked(pick.choices);
	const shown = all.slice(0, count);
	const picked = all.find((choice) => choice.picked);
	if (picked !== undefined && !shown.includes(picked)) shown[shown.length - 1] = picked;
	return { shown: shown.map(raceBranch), total: all.length, cut: pick.cut, answered: pick.answer !== null };
}

/** One step of a race, for the list of steps: the article it started at and the branch the model picked. */
export interface RaceStep {
	/** The moment that shows the step. */
	readonly moment: number;
	readonly from: string;
	/** The picked branch; null before the model answered, or when the step failed. */
	readonly picked: RaceBranch | null;
}

/** Every step of a race, in order. */
export function raceSteps(session: Session): RaceStep[] {
	return session.story.frames.map((frame, index) => {
		const choice = pickOf(frame)?.choices.find((offered) => offered.picked);
		const before = raceOf(frame.before);
		return {
			moment: index + 1,
			from: before === null ? "" : raceHere(before),
			picked: choice === undefined ? null : raceBranch(choice),
		};
	});
}

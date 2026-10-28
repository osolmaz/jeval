/// <reference lib="dom" />
/** The wikirace part of the page: the trail of articles from the start toward the target, and what each step showed. */
import { type DomainPart, h, type Moment, registerPart } from "@osolmaz/switch-viewer/page";

/** What the part reads of a race's state; anything else in it stays in the state's JSON. */
interface RaceTrail {
	readonly target: string;
	readonly titles: readonly string[];
	readonly section: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null;

/** The trail of a moment's state; null when the state is not a race's. */
export function raceTrailOf(state: unknown): RaceTrail | null {
	if (!isRecord(state) || typeof state["target"] !== "string" || !Array.isArray(state["path"])) return null;
	const titles = state["path"].flatMap((visit) =>
		isRecord(visit) && typeof visit["title"] === "string" ? [visit["title"]] : [],
	);
	const sections = Array.isArray(state["sections"]) ? state["sections"] : [];
	const open = typeof state["open"] === "number" ? (sections[state["open"]] as unknown) : null;
	const section = isRecord(open) && typeof open["name"] === "string" ? open["name"] : null;
	return { target: state["target"], titles, section };
}

/** The trail as a row of articles, the current one marked, and the target at its end. */
function raceTrail(trail: RaceTrail): HTMLElement {
	const last = trail.titles.length - 1;
	const reached = trail.titles[last] === trail.target;
	const crumbs = trail.titles.map((title, index) =>
		h("li", { class: index === last ? "race-here" : "race-been" }, title),
	);
	const goal = reached ? [] : [h("li", { class: "race-gap" }, "…"), h("li", { class: "race-goal" }, trail.target)];
	const where = trail.section === null ? "" : `Showing the section "${trail.section}"`;
	return h(
		"div",
		{ class: "race-area" },
		h("p", { class: "race-label" }, reached ? `Reached ${trail.target}` : `Racing to ${trail.target}`),
		h("ol", { class: "race-trail" }, ...crumbs, ...goal),
		h("p", { class: "race-where" }, where),
	);
}

/** The wikirace part: it draws the trail of each moment, and notes the article each step was at. */
export function racePart(): DomainPart {
	return {
		draw(moment: Moment) {
			const trail = raceTrailOf(moment.state);
			return Promise.resolve(trail === null ? null : raceTrail(trail));
		},
		stepNote(moment: Moment) {
			const here = raceTrailOf(moment.state)?.titles.at(-1);
			return here === undefined ? "" : ` · at ${here}`;
		},
		hidden: ["path"],
	};
}

registerPart("wikirace", racePart);

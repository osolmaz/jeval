/// <reference lib="dom" />
/**
 * The wikirace part's drawing: the race's head with its target and status, the route of the articles so far, and the
 * branches of the current step, each with the model's probability, from the article the race is at.
 */
import { type Child, h, type Moment, percent, type Session } from "@osolmaz/switch-viewer/page";
import { type RaceBranch, type RaceFork, raceFork, raceHere, raceHops, raceReached, type RaceView } from "./data.ts";

/** How many branches of a step the drawing shows: the likeliest ones, with the picked one among them. */
export const RACE_BRANCHES = 8;
/** The height of one branch's row, which the curves to the branches follow. */
const ROW = 36;
/** The width of the curves between the article and its branches. */
const FAN = 56;
const SVG = "http://www.w3.org/2000/svg";

/** The address of an article on the English Wikipedia, which the race reads. */
export const articleUrl = (title: string): string =>
	`https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;

/** A link to an article, which opens in a new tab. */
export const articleLink = (title: string, attributes: Readonly<Record<string, string>> = {}): HTMLElement =>
	h("a", { ...attributes, href: articleUrl(title), target: "_blank", rel: "noopener noreferrer" }, title);

/** How the race stands at a moment: racing, or how it ended once the case has its outcome. */
export function raceStatus(moment: Moment, session: Session, race: RaceView): string {
	if (raceReached(race)) return "reached";
	if (race.gaveUp) return "gave up";
	const { outcome } = session;
	const reason = outcome?.["reason"];
	if (moment.type === "end" && typeof reason === "string") return reason;
	return "racing";
}

/** The race's head: from where to which article, the hops so far, and how it stands. */
export function raceHead(race: RaceView, status: string): HTMLElement {
	const start = race.path[0]?.title ?? "";
	const hops = raceHops(race);
	return h(
		"header",
		{ class: "race-head" },
		h(
			"h2",
			{ class: "race-title" },
			start,
			h("span", { class: "race-to", "aria-label": "to" }, " → "),
			articleLink(race.target),
		),
		h(
			"p",
			{ class: "race-score" },
			h("strong", {}, String(hops)),
			hops === 1 ? " hop" : " hops",
			h("span", { class: `race-status race-${status.replaceAll(" ", "-")}` }, status),
		),
	);
}

/** One article of the route, with the link text that led to it when the article's title is another. */
function stop(title: string, via: string, classes: string, arrived: boolean): HTMLElement {
	const parts: Child[] = [h("span", { class: "race-dot", "aria-hidden": "true" }), articleLink(title)];
	if (via !== "" && via !== title) parts.push(h("small", { class: "race-via" }, `via “${via}”`));
	return h("li", { class: `race-stop ${classes}${arrived ? " race-arrived" : ""}` }, ...parts);
}

/**
 * The route: every article so far, the current one marked, and the target at the end, apart when the race has not
 * reached it. The article the step arrived at is marked, so that it can move in.
 */
export function raceRoute(race: RaceView, arrived: boolean): HTMLElement {
	const last = race.path.length - 1;
	const reached = raceReached(race);
	const stops = race.path.map((visit, index) => {
		const classes = index === last ? `race-here${reached ? " race-goal" : ""}` : "race-been";
		return stop(visit.title, index === 0 ? "" : visit.via, classes, arrived && index === last && last > 0);
	});
	if (!reached) {
		stops.push(
			h("li", { class: "race-stop race-gap", "aria-hidden": "true" }, "⋮"),
			stop(race.target, "", "race-target", false),
		);
	}
	return h("ol", { class: "race-route", "aria-label": "The route" }, ...stops);
}

/** A branch's name: a link to its article, a section with its count of links, or giving up. */
function branchName(branch: RaceBranch): HTMLElement {
	if (branch.type === "section") {
		const count = branch.links === null ? "" : ` · ${String(branch.links)} links`;
		return h("span", { class: "race-name race-section" }, `§ ${branch.name}${count}`);
	}
	if (branch.type === "give-up") return h("span", { class: "race-name race-give-up" }, branch.name);
	return articleLink(branch.name, { class: "race-name" });
}

function branchRow(branch: RaceBranch): HTMLElement {
	const width = branch.probability === null ? 0 : Math.round(branch.probability * 1000) / 10;
	return h(
		"li",
		{ class: `race-branch${branch.picked ? " race-picked" : ""}` },
		branchName(branch),
		h("span", { class: "race-bar", "aria-hidden": "true" }, h("i", { style: `width:${String(width)}%` })),
		h("span", { class: "race-p" }, percent(branch.probability)),
	);
}

/** The curves from the article to each branch's row: thicker for a likelier branch, and the picked one marked. */
function curves(branches: readonly RaceBranch[]): SVGSVGElement {
	const height = branches.length * ROW;
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("class", "race-curves");
	svg.setAttribute("width", String(FAN));
	svg.setAttribute("height", String(height));
	svg.setAttribute("viewBox", `0 0 ${String(FAN)} ${String(height)}`);
	svg.setAttribute("aria-hidden", "true");
	branches.forEach((branch, index) => {
		const y = index * ROW + ROW / 2;
		const path = document.createElementNS(SVG, "path");
		path.setAttribute(
			"d",
			`M0 ${String(height / 2)}C${String(FAN / 2)} ${String(height / 2)} ${String(FAN / 2)} ${String(y)} ${String(FAN)} ${String(y)}`,
		);
		const p = branch.probability;
		path.setAttribute("stroke-width", String(p === null ? 1.5 : 1.5 + 6 * p));
		path.setAttribute(
			"class",
			branch.picked ? "race-curve race-picked" : `race-curve${p === null ? " race-unknown" : ""}`,
		);
		svg.append(path);
	});
	return svg;
}

/** What the branches leave out: the rest of the pick's choices, and the ones its limit cut. */
function forkNote(fork: RaceFork): string {
	const rest = fork.total - fork.shown.length;
	const parts = [
		rest > 0 ? `${String(rest)} more choices` : "",
		fork.cut > 0 ? `the limit cut ${String(fork.cut)}` : "",
	];
	return parts.filter((part) => part !== "").join("; ");
}

/** The branches of a step: the article the race is at, the curves, and a row for each branch. */
export function raceBranches(race: RaceView, fork: RaceFork): HTMLElement {
	const order = fork.answered ? "by the model's probability" : "in the article's order, before the model answers";
	const where = race.section === null ? raceHere(race) : `${raceHere(race)}, section “${race.section}”`;
	return h(
		"section",
		{ class: "race-fork", "aria-label": "The choices of the step" },
		h("p", { class: "race-fork-title" }, `${String(fork.total)} choices at ${where}, ${order}`),
		h(
			"div",
			{ class: "race-fan" },
			h("span", { class: "race-node" }, raceHere(race)),
			curves(fork.shown),
			h("ol", { class: "race-branches" }, ...fork.shown.map(branchRow)),
		),
		h("p", { class: "race-more" }, forkNote(fork)),
	);
}

/** The whole drawing of a moment; `motion` is how many milliseconds the article it arrived at takes to move in. */
export function raceDrawing(moment: Moment, session: Session, race: RaceView, motion: number): HTMLElement {
	const fork = moment.type === "step" ? raceFork(moment, RACE_BRANCHES) : null;
	const body = h("div", { class: "race-body" }, raceRoute(race, motion > 0));
	if (fork !== null) body.append(raceBranches(race, fork));
	const drawing = h(
		"div",
		{ class: motion > 0 ? "race race-moving" : "race" },
		raceHead(race, raceStatus(moment, session, race)),
		body,
		h("p", { class: "race-last" }, race.last),
	);
	drawing.style.setProperty("--race-motion", `${String(motion)}ms`);
	return drawing;
}

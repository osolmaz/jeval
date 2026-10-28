import {
	type BoundChoice,
	choiceType,
	type DomainShared,
	joinTypes,
	type JsonObject,
	type Limits,
	type RunResult,
	type StateMachine,
	type View,
} from "@osolmaz/switch";
import type { Race } from "./case.ts";
import type { Section, Wiki } from "./wiki.ts";

/** The most links that one step shows. An article with more shows its lead's links and its other sections. */
export const LINKS = 200;

/** One article of the race: its title, and the text of the link that led to it. */
export interface Visit extends JsonObject {
	readonly title: string;
	readonly via: string;
}

/** Where a race is. */
export interface RaceState extends JsonObject {
	/** The article to reach. */
	readonly target: string;
	/** Every article visited so far, the current one last. */
	readonly path: readonly Visit[];
	/** The current article's links by section. */
	readonly sections: readonly Section[];
	/** The section whose links the step shows, in an article with more links than one step shows; null for the lead. */
	readonly open: number | null;
	/** The sections of the current article opened so far. */
	readonly opened: readonly number[];
	/** What the last step did, in words. */
	readonly last: string;
}

/** 255 is the most answers that a choice question to Jev may have, stop included. */
export const LIMITS: Limits = { steps: 40, choices: 255, windowShare: 0.9 };

export const WIKIRACE: DomainShared = {
	name: "wikirace",
	version: "0.1.0",
	stop: "Give up and lose the race",
	instructions:
		"You race through Wikipedia from article to article by following links, until you reach the target article. Pick the link that brings you closer to the target's subject. A race often takes four to six hops, so a link need not lead to the target at once: broad articles, such as a country, a science or a field of study, link to many others and make good stepping stones. When an article has more links than one step shows, you can also open one of its sections to see the links in it. Giving up loses the race, so pick a link or a section even when none seems close: a broad article is a better bet.",
	limits: LIMITS,
};

/** Wikipedia titles match whatever the case of their first letter. */
const sameTitle = (a: string, b: string): boolean =>
	a.charAt(0).toUpperCase() + a.slice(1) === b.charAt(0).toUpperCase() + b.slice(1);

export const current = (state: RaceState): Visit => state.path.at(-1) ?? { title: "", via: "" };

export const reached = (state: RaceState): boolean => sameTitle(current(state).title, state.target);

/** The current article's sections without the links to articles visited before, by their place in the article. */
function unvisited(state: RaceState): (Section & { readonly index: number })[] {
	const seen = state.path.flatMap((visit) => [visit.title, visit.via]);
	return state.sections.map((section, index) => ({
		index,
		name: section.name,
		links: section.links.filter((link) => !seen.some((title) => sameTitle(title, link))),
	}));
}

/** The links that the state shows: every link of the article when they fit one step, else those of the open section. */
function shownLinks(state: RaceState): string[] {
	if (reached(state)) return [];
	const sections = unvisited(state);
	const all = [...new Set(sections.flatMap((section) => section.links))];
	if (all.length <= LINKS) return all;
	return [...new Set(sections[state.open ?? 0]?.links ?? [])];
}

/** The sections that the state offers to open: none when every link fits one step. */
function shownSections(state: RaceState): (Section & { readonly index: number })[] {
	if (reached(state)) return [];
	const sections = unvisited(state);
	if (new Set(sections.flatMap((section) => section.links)).size <= LINKS) return [];
	const showing = state.open ?? 0;
	return sections.filter(
		(section) => section.index !== showing && !state.opened.includes(section.index) && section.links.length > 0,
	);
}

/** The state after following the link `title`: the article it leads to, after redirects. */
async function followed(wiki: Wiki, state: RaceState, title: string): Promise<RaceState> {
	const article = sameTitle(title, state.target) ? { title: state.target, sections: [] } : await wiki.article(title);
	return {
		target: state.target,
		path: [...state.path, { title: article.title, via: title }],
		sections: article.sections,
		open: null,
		opened: [],
		last: `Followed the link "${title}" to ${article.title}.`,
	};
}

/** Follow a link of the current article that leads to an article not visited yet; the earlier links first. */
const link = (wiki: Wiki) =>
	choiceType<RaceState, string>({
		type: "link",
		choices: (state) =>
			shownLinks(state).map((title, index) => ({ key: title, text: title, arg: title, priority: index + 1 })),
		transition: (state, title) => followed(wiki, state, title),
	});

const sampleOf = (links: readonly string[]): string =>
	links.length <= 3 ? links.join(", ") : `${links.slice(0, 3).join(", ")} and ${String(links.length - 3)} more`;

/** Open a section of an article with more links than one step shows, to see its links; each section at most once. */
const section = choiceType<RaceState, number>({
	type: "section",
	choices: (state) =>
		shownSections(state).map(({ index, name, links }) => ({
			key: `${String(state.path.length)}:${String(index)}`,
			text: `Open section ${String(index)}, "${name}": ${sampleOf(links)}`,
			arg: index,
		})),
	transition: (state, index) => ({
		...state,
		open: index,
		opened: [...state.opened, index],
		last: `Opened the section "${state.sections[index]?.name ?? ""}" of ${current(state).title}.`,
	}),
});

/** What the step shows of the current article, in words. */
function showing(state: RaceState): string {
	const title = current(state).title;
	if (reached(state)) return `${title} is the target.`;
	if (shownSections(state).length === 0 && state.open === null) return `Every link of ${title}.`;
	return `The links of the section "${state.sections[state.open ?? 0]?.name ?? ""}" of ${title}, and its other sections.`;
}

/** What the model reads: the target and what it is about, where the race is, the way here, and what the step shows. */
export function raceView(state: RaceState, about: string): View {
	return {
		decisionState: {
			target: state.target,
			about_the_target: about,
			current_article: current(state).title,
			path: state.path.map((visit) => visit.title).join(" > "),
			showing: showing(state),
			last_step: state.last,
		},
	};
}

/** A race, ready to run: its initial state, and the first sentences of the target, which every view shows. */
export interface OpenedRace {
	readonly initial: RaceState;
	readonly about: string;
}

/** Reads the race's start article and its target from `wiki`: the target's title after redirects, and its summary. */
export async function openRace(race: Race, wiki: Wiki): Promise<OpenedRace> {
	const [start, target] = await Promise.all([wiki.article(race.start), wiki.summary(race.target)]);
	const initial: RaceState = {
		target: target.title,
		path: [{ title: start.title, via: race.start }],
		sections: start.sections,
		open: null,
		opened: [],
		last: `The race starts at ${start.title}.`,
	};
	return { initial, about: target.summary };
}

/** A race's state machine: the race ends when it reaches the target, which has no choices. */
export function raceMachine(race: OpenedRace, wiki: Wiki): StateMachine<RaceState, BoundChoice<RaceState>> {
	return {
		initial: () => Promise.resolve(race.initial),
		...joinTypes(link(wiki), section),
		view: (state) => Promise.resolve(raceView(state, race.about)),
	};
}

/** How a race ended: reached, given up or unfinished, with the hops between articles and the path. */
export function outcomeOf({ state, ended }: Pick<RunResult<RaceState>, "state" | "ended">): JsonObject {
	const facts = { hops: state.path.length - 1, path: state.path.map((visit) => visit.title) };
	if (reached(state)) return { result: "reached", ...facts };
	return { result: ended === "stop" ? "gave up" : "unfinished", reason: ended, ...facts };
}

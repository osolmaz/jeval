/// <reference lib="dom" />
/** The parts of the viewer's page, drawn from a session; `app.ts` puts them together and keeps them current. */
import {
	answerText,
	changesOf,
	type Moment,
	percent,
	pickProbabilities,
	plain,
	ranked,
	type Session,
} from "./model.ts";

/** How many of the likeliest choices the list shows; the picked one always shows. */
const LISTED = 8;
const SPEEDS = ["0.5", "1", "2", "4"];

export type Child = Node | string;

export function h(tag: string, attributes: Readonly<Record<string, string>> = {}, ...children: Child[]): HTMLElement {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
	node.append(...children);
	return node;
}

export const button = (label: string, name: string, text: string): HTMLButtonElement => {
	const node = h("button", { type: "button", class: name, "aria-label": label, title: label }, text);
	return node as HTMLButtonElement;
};

function choiceList(moment: Moment): HTMLElement {
	const choices = ranked(moment.frame?.choices ?? []);
	const listed = choices.filter((choice, rank) => rank < LISTED || choice.picked);
	const rows = listed.map((choice) => {
		const share = choice.probability ?? 0;
		const bar = h("span", { class: "track", "aria-hidden": "true" }, h("span", { style: `--p:${share.toFixed(4)}` }));
		const text = h(
			"span",
			{ class: "text" },
			choice.text,
			choice.picked ? h("span", { class: "hidden" }, " (picked)") : "",
		);
		return h(
			"li",
			choice.picked ? { class: "picked" } : {},
			text,
			bar,
			h("span", { class: "p" }, percent(choice.probability)),
		);
	});
	const rest = choices.length - listed.length;
	const cut = moment.frame?.cut ?? 0;
	return h(
		"div",
		{},
		h("ol", { class: "choices" }, ...rows),
		rest > 0 ? h("p", { class: "quiet" }, `and ${String(rest)} more`) : "",
		cut > 0 ? h("p", { class: "quiet" }, `The limit cut ${String(cut)} more, which the model did not see.`) : "",
	);
}

/** What a step changed in the state, one line for each change; nothing after stop or a failed pick. */
function changes(moment: Moment): HTMLElement[] {
	const after = moment.frame?.after ?? null;
	if (after === null) return [];
	const lines = changesOf(moment.frame?.before ?? null, after).map((line) => h("p", { class: "change" }, line));
	return [
		h("h3", {}, "What changed"),
		...(lines.length > 0 ? lines : [h("p", { class: "quiet" }, "Nothing changed.")]),
	];
}

/** A step's choices with the model's probabilities, what the pick changed and its notes; `note` follows its label. */
export function decisionPanel(moment: Moment, note = ""): HTMLElement {
	if (moment.type !== "step" || moment.frame === null) {
		const texts = moment.type === "start" ? "Before the first pick." : "The case is over.";
		return h("section", { class: "decision" }, h("h2", {}, moment.label), h("p", { class: "quiet" }, texts));
	}
	const { frame } = moment;
	const picking = frame.picked === null && frame.notes.length === 0;
	const title = picking ? "The model is picking from the choices…" : "The choices";
	const found = changes(moment);
	const notes = frame.notes.map((text) => h("p", { class: "quiet" }, text));
	return h(
		"section",
		{ class: "decision" },
		h("h2", {}, title),
		h("p", { class: "step" }, `${moment.label}${note}`),
		choiceList(moment),
		...found,
		...notes,
	);
}

/** How the case stands, when there is something to say beyond its facts: running, failed, or ended early. */
function statusOf(session: Session, facts: number): string | null {
	const { ended, error, thrown } = session.story;
	if (!session.finished) return "The case is running.";
	if (thrown !== null) {
		return `The case failed ${ended === null ? "before its steps ended" : "after its steps"}: ${thrown}`;
	}
	if (error !== null) return `The answers failed: ${error}`;
	if (ended === "pick failed") return "A pick failed, so the steps ended early.";
	return facts === 0 ? "The case ended with no outcome and no answers." : null;
}

/** The outcome's facts but the `hidden` ones, then the answers, as rows of a list. */
function factRows(session: Session, hidden: readonly string[]): HTMLElement[] {
	const left = new Set(hidden);
	const facts = Object.entries(session.outcome ?? {})
		.filter(([key]) => !left.has(key))
		.flatMap(([key, value]) => [h("dt", {}, key), h("dd", {}, plain(value))]);
	const answers = Object.entries(session.story.answers ?? {}).flatMap(([id, answer]) => [
		h("dt", {}, id),
		h("dd", {}, answerText(answer)),
	]);
	return [...facts, ...answers];
}

/**
 * How the case ended: a banner with the domain's summary, how the case stands, the notes after its steps, and the
 * outcome's facts and the answers, which show whether or not the domain gives an outcome. A domain's viewer gives the
 * summary, and its part the facts it leaves out.
 */
export function resultPanel(session: Session | null, waiting: boolean, hidden: readonly string[]): HTMLElement {
	if (session === null) {
		const text = waiting ? "Waiting for the case to start…" : "Loading…";
		return h("section", { class: "result" }, h("p", { class: "quiet" }, text));
	}
	const rows = factRows(session, hidden);
	const status = statusOf(session, rows.length);
	const lines = [...(status === null ? [] : [status]), ...session.story.notes];
	return h(
		"section",
		{ class: "result" },
		session.summary === null ? "" : h("p", { class: "banner" }, session.summary),
		...lines.map((line) => h("p", { class: "quiet" }, line)),
		rows.length === 0 ? "" : h("dl", { class: "facts" }, ...rows),
	);
}

/** The probability of each step's pick as a filled graph, with the current step marked. */
export function pickChart(session: Session, index: number): HTMLElement[] {
	const series = pickProbabilities(session.story);
	if (series.length < 2) return [];
	const width = 300;
	const x = (step: number) => ((step / (series.length - 1)) * width).toFixed(1);
	const y = (probability: number) => (64 - probability * 64).toFixed(1);
	const points = series.flatMap((probability, step) => (probability === null ? [] : [`${x(step)},${y(probability)}`]));
	const area = `0,64 ${points.join(" ")} ${String(width)},64`;
	const marker =
		index >= 1 && index <= series.length
			? `<line x1="${x(index - 1)}" x2="${x(index - 1)}" y1="0" y2="64" class="now"/>`
			: "";
	const chart = h("div", { class: "spark" });
	chart.innerHTML = `<svg viewBox="0 0 ${String(width)} 64" preserveAspectRatio="none" role="img" aria-label="The probability of each pick"><polygon points="${area}"/><line x1="0" x2="${String(width)}" y1="32" y2="32" class="mid"/>${marker}</svg>`;
	return [h("h2", {}, "Probability of each pick"), chart];
}

/** The parts of the page that change. */
export interface Parts {
	/** Where the domain's part draws the current moment, or the page shows the state as JSON. */
	readonly drawing: HTMLElement;
	readonly chart: HTMLElement;
	readonly side: HTMLElement;
	/** The title of the steps list, which a domain's part names. */
	readonly stepsTitle: HTMLElement;
	readonly steps: HTMLElement;
	readonly result: HTMLElement;
	readonly live: HTMLElement;
	/** The header's name and case title, a link to the run's cases when the page has a server. */
	readonly home: HTMLAnchorElement;
	readonly title: HTMLElement;
	readonly meta: HTMLElement;
	readonly download: HTMLButtonElement;
	readonly scrub: HTMLInputElement;
	readonly where: HTMLElement;
	readonly play: HTMLButtonElement;
	readonly speed: HTMLSelectElement;
	readonly controls: HTMLElement;
}

function speedSelect(): HTMLSelectElement {
	const speeds = SPEEDS.map((speed) =>
		h("option", speed === "1" ? { value: speed, selected: "" } : { value: speed }, `${speed}×`),
	);
	return h("select", { "aria-label": "Speed" }, ...speeds) as HTMLSelectElement;
}

export function layout(root: HTMLElement): Parts {
	const parts = {
		drawing: h("div", { class: "drawing-slot" }),
		chart: h("section", { class: "card chart" }),
		side: h("div", { class: "card side-slot" }),
		stepsTitle: h("h2", {}, "Result"),
		steps: h("section", { class: "steps", "aria-label": "Steps" }),
		result: h("div", { class: "result-slot" }),
		live: h("span", { class: "live", hidden: "" }, "Live"),
		home: h("a", { class: "home" }) as HTMLAnchorElement,
		title: h("h1", {}, "switch"),
		meta: h("span", { class: "meta" }),
		download: button("Download", "download", "Download"),
		scrub: h("input", { type: "range", min: "0", max: "0", value: "0", "aria-label": "Step" }) as HTMLInputElement,
		where: h("output", { "aria-live": "polite" }),
		play: button("Play", "play", "Play"),
		speed: speedSelect(),
		controls: h("div", { class: "controls" }),
	};
	parts.download.hidden = true;
	parts.home.append(h("span", { class: "brand" }, "switch"), parts.title);
	const header = h(
		"header",
		{ class: "bar" },
		parts.home,
		parts.meta,
		parts.live,
		h("span", { class: "spacer" }),
		parts.download,
	);
	const drawing = h("section", { class: "drawing", "aria-label": "The case" }, parts.drawing);
	const timeline = h("div", { class: "card timeline" }, parts.stepsTitle, parts.steps, parts.result, parts.controls);
	const side = h("aside", { class: "side" }, parts.chart, parts.side, timeline);
	root.replaceChildren(h("div", { class: "app" }, header, h("main", { class: "layout" }, drawing, side)));
	return parts;
}

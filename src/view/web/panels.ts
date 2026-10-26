/// <reference lib="dom" />
/** The parts of the viewer's page, drawn from a session; `app.ts` puts them together and keeps them current. */
import type { Arrow, Position } from "./board.ts";
import {
	answerText,
	captures,
	type ChessStep,
	chessOption,
	chessStep,
	confidence,
	type Moment,
	percent,
	piecesOf,
	type Ply,
	plain,
	pliesOf,
	ranked,
	type Session,
} from "./model.ts";
import type { Story } from "../frames.ts";

/** How many of the likeliest options get an arrow, and how many the list shows; the chosen one always does. */
const ARROWS = 5;
const LISTED = 8;
const SPEEDS = ["0.5", "1", "2", "4"];

type Child = Node | string;

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

/** The king's square when the side to move is in check. */
function checkSquare(step: ChessStep): string | null {
	if (!step.check) return null;
	const turn = step.fen.split(" ")[1] === "b" ? "b" : "w";
	return piecesOf(step.fen).find((piece) => piece.kind === "k" && piece.color === turn)?.square ?? null;
}

/** The arrows of a step: the likeliest moves and the chosen one. */
function arrowsOf(moment: Moment): Arrow[] {
	const options = ranked(moment.frame?.options ?? []);
	return options.flatMap((option, rank) => {
		const move = chessOption(option.data);
		const { probability } = option;
		// Before the model answers, no option has a probability, and no arrow would mean anything.
		if (move === null || probability === null || (rank >= ARROWS && !option.chosen)) return [];
		return [{ ...move, probability, chosen: option.chosen, label: `${move.san} ${percent(probability)}` }];
	});
}

export function positionOf(moment: Moment): Position | null {
	const step = chessStep(moment.seen?.data);
	if (step === null) return null;
	const last = step.moves.at(-1);
	return {
		fen: step.fen,
		flipped: step.you === "black",
		last: last === undefined ? [] : [last.slice(0, 2), last.slice(2, 4)],
		check: checkSquare(step),
		arrows: moment.kind === "step" ? arrowsOf(moment) : [],
	};
}

function optionList(moment: Moment): HTMLElement {
	const options = ranked(moment.frame?.options ?? []);
	const listed = options.filter((option, rank) => rank < LISTED || option.chosen);
	const rows = listed.map((option) => {
		const share = option.probability ?? 0;
		const bar = h("span", { class: "track", "aria-hidden": "true" }, h("span", { style: `--p:${share.toFixed(4)}` }));
		const text = h(
			"span",
			{ class: "text" },
			option.text,
			option.chosen ? h("span", { class: "hidden" }, " (chosen)") : "",
		);
		return h(
			"li",
			option.chosen ? { class: "chosen" } : {},
			text,
			bar,
			h("span", { class: "p" }, percent(option.probability)),
		);
	});
	const rest = options.length - listed.length;
	return h(
		"div",
		{},
		h("ol", { class: "menu" }, ...rows),
		rest > 0 ? h("p", { class: "quiet" }, `and ${String(rest)} more`) : "",
	);
}

export function decisionPanel(moment: Moment): HTMLElement {
	if (moment.kind !== "step" || moment.frame === null) {
		const texts = moment.kind === "start" ? "Before the first choice." : "The case is over.";
		return h("section", { class: "decision" }, h("h2", {}, moment.label), h("p", { class: "quiet" }, texts));
	}
	const { frame } = moment;
	const choosing = frame.chosen === null && frame.notes.length === 0;
	const title = `${moment.label}: ${choosing ? "the model is choosing" : "the model's options"}`;
	const found =
		frame.after === null ? [] : [h("h3", {}, "What happened"), h("p", { class: "found" }, frame.after.text)];
	const notes = frame.notes.map((note) => h("p", { class: "quiet" }, note));
	return h("section", { class: "decision" }, h("h2", {}, title), optionList(moment), ...found, ...notes);
}

export function resultPanel(session: Session | null, waiting: boolean): HTMLElement {
	if (session === null) {
		return h(
			"section",
			{ class: "result" },
			h("p", { class: "quiet" }, waiting ? "Waiting for the case to start…" : "Loading…"),
		);
	}
	const { outcome, finished, story } = session;
	if (outcome === null) {
		return h(
			"section",
			{ class: "result" },
			h("p", { class: "quiet" }, finished ? "The case ended without an outcome." : "The case is running."),
		);
	}
	const headline = [outcome["result"], outcome["reason"]].filter((part) => typeof part === "string").join(" · ");
	const facts = Object.entries(outcome)
		.filter(([key]) => key !== "result" && key !== "reason" && key !== "fen")
		.flatMap(([key, value]) => [h("dt", {}, key), h("dd", {}, plain(value))]);
	const answers = Object.entries(story.answers ?? {}).flatMap(([id, answer]) => [
		h("dt", {}, id),
		h("dd", {}, answerText(answer)),
	]);
	return h(
		"section",
		{ class: "result" },
		h("p", { class: "headline" }, headline),
		h("dl", { class: "facts" }, ...facts, ...answers),
	);
}

/** The chosen move's probability over the steps, with the current step marked. */
export function confidenceChart(session: Session, index: number): HTMLElement {
	const series = confidence(session.story);
	if (series.length < 2) return h("section", { class: "chart" });
	const width = 300;
	const x = (step: number) => ((step / (series.length - 1)) * width).toFixed(1);
	const y = (probability: number) => (60 - probability * 56).toFixed(1);
	const points = series.flatMap((probability, step) => (probability === null ? [] : [`${x(step)},${y(probability)}`]));
	const marker =
		index >= 1 && index <= series.length
			? `<line x1="${x(index - 1)}" x2="${x(index - 1)}" y1="0" y2="62" class="now"/>`
			: "";
	const chart = h("div", { class: "spark" });
	chart.innerHTML = `<svg viewBox="0 -2 ${String(width)} 66" preserveAspectRatio="none" role="img" aria-label="The model's probability for each chosen move"><line x1="0" x2="${String(width)}" y1="32" y2="32" class="mid"/>${marker}<polyline points="${points.join(" ")}"/></svg>`;
	return h("section", { class: "chart" }, h("h2", {}, "Confidence in each chosen move"), chart);
}

function plyButton(ply: Ply, current: boolean, open: (moment: number) => void): HTMLElement {
	const label = ply.byModel
		? `${ply.san}, the model's move at ${percent(ply.probability)}`
		: `${ply.san}, the opponent's move`;
	const node = button(label, `ply${ply.byModel ? " model" : ""}${current ? " current" : ""}`, ply.san);
	if (ply.byModel && ply.probability !== null) node.append(h("small", {}, percent(ply.probability)));
	if (current) node.setAttribute("aria-current", "step");
	node.addEventListener("click", () => {
		open(ply.moment);
	});
	return node;
}

/** The game's moves in numbered rows. Each move opens its moment; the latest move on the board is marked. */
export function moveList(story: Story, index: number, open: (moment: number) => void): HTMLElement[] {
	const plies = pliesOf(story);
	const current = plies.findLastIndex((ply) => ply.shown <= index);
	const rows = new Map<number, HTMLElement[]>();
	plies.forEach((ply, at) => {
		const row = rows.get(ply.number) ?? [h("span", { class: "number" }, `${String(ply.number)}.`)];
		if (ply.color === "b" && row.length === 1) row.push(h("span", { class: "ply" }, "…"));
		row.push(plyButton(ply, at === current, open));
		rows.set(ply.number, row);
	});
	if (rows.size === 0) return [];
	return [h("h2", {}, "Moves"), h("ol", { class: "plies" }, ...[...rows.values()].map((row) => h("li", {}, ...row)))];
}

export function playerRow(
	name: string,
	color: "w" | "b",
	fen: string,
	images: Readonly<Record<string, string>>,
): HTMLElement {
	const { lost, lead } = captures(fen);
	const other = color === "w" ? "b" : "w";
	const taken = lost[other].map((kind) => h("img", { src: images[`${other}${kind.toUpperCase()}`] ?? "", alt: "" }));
	const ahead = color === "w" ? lead : -lead;
	return h(
		"div",
		{ class: "player" },
		h("span", { class: `swatch ${color}` }),
		h("span", { class: "name" }, name),
		h("span", { class: "taken" }, ...taken),
		h("span", { class: "lead" }, ahead > 0 ? `+${String(ahead)}` : ""),
	);
}

/** The parts of the page that change. */
export interface Parts {
	readonly top: HTMLElement;
	readonly stage: HTMLElement;
	readonly bottom: HTMLElement;
	readonly side: HTMLElement;
	readonly moves: HTMLElement;
	readonly result: HTMLElement;
	readonly live: HTMLElement;
	readonly title: HTMLElement;
	readonly meta: HTMLElement;
	readonly pgn: HTMLButtonElement;
	readonly page: HTMLElement;
	readonly scrub: HTMLInputElement;
	readonly where: HTMLElement;
	readonly play: HTMLButtonElement;
	readonly speed: HTMLSelectElement;
	readonly controls: HTMLElement;
}

export function layout(root: HTMLElement): Parts {
	const parts = {
		top: h("div", { class: "player-slot" }),
		stage: h("div", { class: "stage-slot" }),
		bottom: h("div", { class: "player-slot" }),
		side: h("div", { class: "side-slot" }),
		moves: h("section", { class: "moves" }),
		result: h("div", { class: "result-slot" }),
		live: h("span", { class: "live", hidden: "" }, "Live"),
		title: h("h1", {}, "switch"),
		meta: h("span", { class: "meta" }),
		pgn: button("Download the game as PGN", "download", "PGN"),
		page: h("a", { class: "download", hidden: "", download: "" }, "Save page"),
		scrub: h("input", { type: "range", min: "0", max: "0", value: "0", "aria-label": "Step" }) as HTMLInputElement,
		where: h("output", { "aria-live": "polite" }),
		play: button("Play", "play", "Play"),
		speed: h(
			"select",
			{ "aria-label": "Speed" },
			...SPEEDS.map((speed) =>
				h("option", speed === "1" ? { value: speed, selected: "" } : { value: speed }, `${speed}×`),
			),
		) as HTMLSelectElement,
		controls: h("div", { class: "controls" }),
	};
	parts.pgn.hidden = true;
	const header = h(
		"header",
		{ class: "bar" },
		h("span", { class: "brand" }, "switch"),
		parts.title,
		parts.meta,
		parts.live,
		h("span", { class: "spacer" }),
		parts.pgn,
		parts.page,
	);
	const stage = h(
		"section",
		{ class: "stage", "aria-label": "The case" },
		parts.top,
		parts.stage,
		parts.bottom,
		parts.controls,
	);
	root.replaceChildren(
		h(
			"div",
			{ class: "app" },
			header,
			h("main", { class: "layout" }, stage, h("aside", { class: "side" }, parts.side, parts.moves, parts.result)),
		),
	);
	return parts;
}

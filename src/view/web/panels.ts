/// <reference lib="dom" />
/** The parts of the viewer's page, drawn from a session; `app.ts` puts them together and keeps them current. */
import type { Arrow, Position } from "./board.ts";
import {
	answerText,
	captures,
	chessChoice,
	type ChessStep,
	chessStep,
	confidence,
	type Moment,
	percent,
	piecesOf,
	type Ply,
	plain,
	pliesOf,
	ranked,
	scoreOf,
	type Session,
} from "./model.ts";
import type { Story } from "../frames.ts";

/** How many of the likeliest choices get an arrow, and how many the list shows; the chosen one always does. */
const ARROWS = 5;
const LISTED = 8;
const SPEEDS = ["0.5", "1", "2", "4"];
type Images = Readonly<Record<string, string>>;

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
	const choices = ranked(moment.frame?.choices ?? []);
	return choices.flatMap((choice, rank) => {
		const move = chessChoice(choice.data);
		const { probability } = choice;
		// Before the model answers, no choice has a probability, and no arrow would mean anything.
		if (move === null || probability === null || (rank >= ARROWS && !choice.chosen)) return [];
		return [{ ...move, probability, chosen: choice.chosen, label: `${move.san} ${percent(probability)}` }];
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

function choiceList(moment: Moment): HTMLElement {
	const choices = ranked(moment.frame?.choices ?? []);
	const listed = choices.filter((choice, rank) => rank < LISTED || choice.chosen);
	const rows = listed.map((choice) => {
		const share = choice.probability ?? 0;
		const bar = h("span", { class: "track", "aria-hidden": "true" }, h("span", { style: `--p:${share.toFixed(4)}` }));
		const text = h(
			"span",
			{ class: "text" },
			choice.text,
			choice.chosen ? h("span", { class: "hidden" }, " (chosen)") : "",
		);
		return h(
			"li",
			choice.chosen ? { class: "chosen" } : {},
			text,
			bar,
			h("span", { class: "p" }, percent(choice.probability)),
		);
	});
	const rest = choices.length - listed.length;
	return h(
		"div",
		{},
		h("ol", { class: "menu" }, ...rows),
		rest > 0 ? h("p", { class: "quiet" }, `and ${String(rest)} more`) : "",
	);
}

/** Who is to move in a chess step, such as "white to move"; empty for other domains. */
function turnOf(moment: Moment): string {
	const step = chessStep(moment.seen?.data);
	if (step === null) return "";
	return step.fen.split(" ")[1] === "b" ? " · black to move" : " · white to move";
}

export function decisionPanel(moment: Moment): HTMLElement {
	if (moment.kind !== "step" || moment.frame === null) {
		const texts = moment.kind === "start" ? "Before the first choice." : "The case is over.";
		return h("section", { class: "decision" }, h("h2", {}, moment.label), h("p", { class: "quiet" }, texts));
	}
	const { frame } = moment;
	const choosing = frame.chosen === null && frame.notes.length === 0;
	const title = choosing ? "The model is choosing from the menu…" : "The menu";
	const found =
		frame.after === null ? [] : [h("h3", {}, "What happened"), h("p", { class: "found" }, frame.after.text)];
	const notes = frame.notes.map((note) => h("p", { class: "quiet" }, note));
	return h(
		"section",
		{ class: "decision" },
		h("h2", {}, title),
		h("p", { class: "step" }, `${moment.label}${turnOf(moment)}`),
		choiceList(moment),
		...found,
		...notes,
	);
}

function waitingPanel(session: Session | null, waiting: boolean): HTMLElement | null {
	if (session === null) return h("p", { class: "quiet" }, waiting ? "Waiting for the case to start…" : "Loading…");
	if (session.outcome !== null) return null;
	return h("p", { class: "quiet" }, session.finished ? "The case ended without an outcome." : "The case is running.");
}

/** How the case ended: a banner with the score and the reason, and the outcome's other facts and the answers. */
export function resultPanel(session: Session | null, waiting: boolean): HTMLElement {
	const pending = waitingPanel(session, waiting);
	if (pending !== null || session === null) return h("section", { class: "result" }, pending ?? "");
	const outcome = session.outcome ?? {};
	const headline = [outcome["result"], outcome["reason"]].filter((part) => typeof part === "string").join(" · ");
	const score = scoreOf(session);
	const facts = Object.entries(outcome)
		.filter(([key]) => key !== "result" && key !== "reason" && key !== "fen")
		.flatMap(([key, value]) => [h("dt", {}, key), h("dd", {}, plain(value))]);
	const answers = Object.entries(session.story.answers ?? {}).flatMap(([id, answer]) => [
		h("dt", {}, id),
		h("dd", {}, answerText(answer)),
	]);
	return h(
		"section",
		{ class: "result" },
		h("p", { class: "banner" }, score === null ? "" : h("strong", {}, score), h("span", {}, headline)),
		h("dl", { class: "facts" }, ...facts, ...answers),
	);
}

/** The chosen move's probability over the steps as a filled graph, with the current step marked. */
export function confidenceChart(session: Session, index: number): HTMLElement[] {
	const series = confidence(session.story);
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
	chart.innerHTML = `<svg viewBox="0 0 ${String(width)} 64" preserveAspectRatio="none" role="img" aria-label="The model's probability for each chosen move"><polygon points="${area}"/><line x1="0" x2="${String(width)}" y1="32" y2="32" class="mid"/>${marker}</svg>`;
	return [h("h2", {}, "Model confidence"), chart];
}

/** A move in figurine notation: the piece's image in place of its letter, light on the dark list, as chess.com writes. */
function figurine(ply: Ply, images: Images): Child[] {
	const letter = ply.san.charAt(0);
	if (!"KQRBN".includes(letter) || ply.san.startsWith("O-O")) return [ply.san];
	const image = h("img", { src: images[`w${letter}`] ?? "", alt: letter, class: "figure" });
	return [image, ply.san.slice(1)];
}

function plyButton(ply: Ply, current: boolean, images: Images, open: (moment: number) => void): HTMLElement {
	const label = ply.byModel
		? `${ply.san}, the model's move at ${percent(ply.probability)}`
		: `${ply.san}, the opponent's move`;
	const node = button(label, `ply${ply.byModel ? " model" : ""}${current ? " current" : ""}`, "");
	node.append(h("span", { class: "san" }, ...figurine(ply, images)));
	if (ply.byModel && ply.probability !== null) node.append(h("small", {}, percent(ply.probability)));
	if (current) node.setAttribute("aria-current", "step");
	node.addEventListener("click", () => {
		open(ply.moment);
	});
	return node;
}

/** The game's moves in numbered rows. Each move opens its moment; the latest move on the board is marked. */
export function moveList(story: Story, index: number, images: Images, open: (moment: number) => void): HTMLElement[] {
	const plies = pliesOf(story);
	const current = plies.findLastIndex((ply) => ply.shown <= index);
	const rows = new Map<number, HTMLElement[]>();
	plies.forEach((ply, at) => {
		const row = rows.get(ply.number) ?? [h("span", { class: "number" }, `${String(ply.number)}.`)];
		if (ply.color === "b" && row.length === 1) row.push(h("span", { class: "ply empty" }, "…"));
		row.push(plyButton(ply, at === current, images, open));
		rows.set(ply.number, row);
	});
	if (rows.size === 0) return [];
	return [h("ol", { class: "plies" }, ...[...rows.values()].map((row) => h("li", {}, ...row)))];
}

/** A player's bar: the king of their color, their name, the pieces they took, and a box lit while they are to move. */
export function playerRow(name: string, color: "w" | "b", fen: string, images: Images): HTMLElement {
	const { lost, lead } = captures(fen);
	const other = color === "w" ? "b" : "w";
	const taken = lost[other].map((kind) => h("img", { src: images[`${other}${kind.toUpperCase()}`] ?? "", alt: "" }));
	const ahead = color === "w" ? lead : -lead;
	const toMove = (fen.split(" ")[1] === "b" ? "b" : "w") === color;
	return h(
		"div",
		{ class: "player" },
		h("img", { class: "avatar", src: images[`${color}K`] ?? "", alt: "" }),
		h(
			"div",
			{ class: "who" },
			h("span", { class: "name" }, name),
			h("span", { class: "taken" }, ...taken, ahead > 0 ? h("span", { class: "lead" }, `+${String(ahead)}`) : ""),
		),
		h("span", { class: `clock ${color}${toMove ? " active" : ""}` }, color === "w" ? "White" : "Black"),
	);
}

/** The parts of the page that change. */
export interface Parts {
	readonly top: HTMLElement;
	readonly stage: HTMLElement;
	readonly bottom: HTMLElement;
	readonly chart: HTMLElement;
	readonly side: HTMLElement;
	readonly moves: HTMLElement;
	readonly result: HTMLElement;
	readonly live: HTMLElement;
	/** The header's name and case title, a link to the run's cases when the page has a server. */
	readonly home: HTMLAnchorElement;
	readonly title: HTMLElement;
	readonly meta: HTMLElement;
	readonly pgn: HTMLButtonElement;
	readonly sound: HTMLButtonElement;
	readonly scrub: HTMLInputElement;
	readonly where: HTMLElement;
	readonly play: HTMLButtonElement;
	readonly speed: HTMLSelectElement;
	readonly controls: HTMLElement;
}

function speedSelect(): HTMLSelectElement {
	const options = SPEEDS.map((speed) =>
		h("option", speed === "1" ? { value: speed, selected: "" } : { value: speed }, `${speed}×`),
	);
	return h("select", { "aria-label": "Speed" }, ...options) as HTMLSelectElement;
}

export function layout(root: HTMLElement): Parts {
	const parts = {
		top: h("div", { class: "player-slot" }),
		stage: h("div", { class: "stage-slot" }),
		bottom: h("div", { class: "player-slot" }),
		chart: h("section", { class: "card chart" }),
		side: h("div", { class: "card side-slot" }),
		moves: h("section", { class: "moves", "aria-label": "Moves" }),
		result: h("div", { class: "result-slot" }),
		live: h("span", { class: "live", hidden: "" }, "Live"),
		home: h("a", { class: "home" }) as HTMLAnchorElement,
		title: h("h1", {}, "switch"),
		meta: h("span", { class: "meta" }),
		pgn: button("Download the game as PGN", "download", "PGN"),
		sound: button("Turn the sound off", "sound", "Sound on"),
		scrub: h("input", { type: "range", min: "0", max: "0", value: "0", "aria-label": "Step" }) as HTMLInputElement,
		where: h("output", { "aria-live": "polite" }),
		play: button("Play", "play", "Play"),
		speed: speedSelect(),
		controls: h("div", { class: "controls" }),
	};
	parts.pgn.hidden = true;
	parts.sound.hidden = true;
	parts.home.append(h("span", { class: "brand" }, "switch"), parts.title);
	const header = h(
		"header",
		{ class: "bar" },
		parts.home,
		parts.meta,
		parts.live,
		h("span", { class: "spacer" }),
		parts.sound,
		parts.pgn,
	);
	const stage = h("section", { class: "stage", "aria-label": "The case" }, parts.top, parts.stage, parts.bottom);
	const history = h("div", { class: "card history" }, h("h2", {}, "Moves"), parts.moves, parts.result, parts.controls);
	const side = h("aside", { class: "side" }, parts.chart, parts.side, history);
	root.replaceChildren(h("div", { class: "app" }, header, h("main", { class: "layout" }, stage, side)));
	return parts;
}

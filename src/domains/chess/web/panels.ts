/// <reference lib="dom" />
/** The chess part's pieces of the page: the board's position and arrows, the move list and the players' bars. */
import type { Story } from "../../../view/frames.ts";
import { percent, ranked, type Moment } from "../../../view/web/model.ts";
import { button, type Child, h } from "../../../view/web/panels.ts";
import type { Arrow, Position } from "./board.ts";
import { type ChessStepData, chessChoice, chessStep } from "./data.ts";
import { captures, piecesOf, pliesOf, type Ply } from "./model.ts";

/** How many of the likeliest moves get an arrow; the chosen one always does. */
const ARROWS = 5;
type Images = Readonly<Record<string, string>>;

/** The king's square when the side to move is in check. */
function checkSquare(step: ChessStepData): string | null {
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

/** The position the board shows for a moment; null when the moment has no chess data. */
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

/** Who is to move in a chess step, such as " · white to move"; empty for a moment without chess data. */
export function turnOf(moment: Moment): string {
	const step = chessStep(moment.seen?.data);
	if (step === null) return "";
	return step.fen.split(" ")[1] === "b" ? " · black to move" : " · white to move";
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

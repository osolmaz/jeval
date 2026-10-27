/// <reference lib="dom" />
import { type Piece, piecesOf, play, samePlaces } from "./model.ts";

/** An arrow for one option of the model: as wide as its probability, dark when the model chose it. */
export interface Arrow {
	readonly from: string;
	readonly to: string;
	readonly probability: number;
	readonly chosen: boolean;
	readonly label: string;
}

export interface Position {
	readonly fen: string;
	/** Whether black is at the bottom. */
	readonly flipped: boolean;
	/** The squares of the move that led here. */
	readonly last: readonly string[];
	/** The square of a king in check. */
	readonly check: string | null;
	readonly arrows: readonly Arrow[];
}

export interface BoardView {
	readonly element: HTMLElement;
	/** Shows a position at once. */
	show(position: Position): void;
	/** Plays `moves` from the position shown, `milliseconds` each, then shows `position`; `landed` hears each land. */
	animate(
		moves: readonly string[],
		position: Position,
		milliseconds: number,
		landed?: (move: number) => void,
	): Promise<void>;
}

const SVG = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";

const columnOf = (square: string, flipped: boolean): number => {
	const file = FILES.indexOf(square.charAt(0));
	return flipped ? 7 - file : file;
};
const rowOf = (square: string, flipped: boolean): number => {
	const rank = Number(square.charAt(1));
	return flipped ? rank - 1 : 8 - rank;
};

const wait = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});

/** The polygon of an arrow in square units: a shaft as wide as the probability, and a head. */
export function arrowPoints(arrow: Arrow, flipped: boolean): string {
	const from = { x: columnOf(arrow.from, flipped) + 0.5, y: rowOf(arrow.from, flipped) + 0.5 };
	const to = { x: columnOf(arrow.to, flipped) + 0.5, y: rowOf(arrow.to, flipped) + 0.5 };
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
	const across = { x: -along.y, y: along.x };
	const width = 0.07 + 0.28 * arrow.probability;
	const head = { length: 0.24 + 0.5 * width, half: 0.14 + 0.45 * width };
	const start = { x: from.x + along.x * 0.18, y: from.y + along.y * 0.18 };
	const base = { x: to.x - along.x * head.length, y: to.y - along.y * head.length };
	const at = (point: { x: number; y: number }, side: number): string =>
		`${(point.x + across.x * side).toFixed(3)},${(point.y + across.y * side).toFixed(3)}`;
	return [
		at(start, width / 2),
		at(base, width / 2),
		at(base, head.half),
		at(to, 0),
		at(base, -head.half),
		at(base, -width / 2),
		at(start, -width / 2),
	].join(" ");
}

function squares(document: Document): HTMLElement {
	const grid = document.createElement("div");
	grid.className = "squares";
	for (let index = 0; index < 64; index += 1) {
		const cell = document.createElement("div");
		cell.className = (Math.floor(index / 8) + (index % 8)) % 2 === 0 ? "square light" : "square dark";
		grid.append(cell);
	}
	return grid;
}

/** Writes the file letters along the bottom row and the rank numbers down the left column. */
function label(grid: HTMLElement, flipped: boolean): void {
	Array.from(grid.children).forEach((cell, index) => {
		const row = Math.floor(index / 8);
		const column = index % 8;
		const file = FILES.charAt(flipped ? 7 - column : column);
		const rank = String(flipped ? row + 1 : 8 - row);
		const parts: string[] = [];
		if (column === 0) parts.push(`<span class="rank">${rank}</span>`);
		if (row === 7) parts.push(`<span class="file">${file}</span>`);
		cell.innerHTML = parts.join("");
	});
}

function layer(document: Document, name: string): HTMLElement {
	const element = document.createElement("div");
	element.className = name;
	return element;
}

/** A chess board that shows positions and plays moves with animation. */
class ChessBoard implements BoardView {
	readonly element: HTMLElement;
	private readonly document: Document;
	private readonly images: Readonly<Record<string, string>>;
	private readonly grid: HTMLElement;
	private readonly marks: HTMLElement;
	private readonly layer: HTMLElement;
	private readonly arrows: SVGSVGElement;
	private readonly nodes = new Map<number, HTMLElement>();
	private pieces: Piece[] = [];
	private flipped = false;

	constructor(document: Document, images: Readonly<Record<string, string>>) {
		this.document = document;
		this.images = images;
		this.element = layer(document, "board");
		this.grid = squares(document);
		this.marks = layer(document, "marks");
		this.layer = layer(document, "pieces");
		this.arrows = document.createElementNS(SVG, "svg");
		this.arrows.setAttribute("class", "arrows");
		this.arrows.setAttribute("viewBox", "0 0 8 8");
		this.arrows.setAttribute("aria-hidden", "true");
		this.element.append(this.grid, this.marks, this.layer, this.arrows);
		this.element.setAttribute("role", "img");
	}

	show(position: Position): void {
		this.flipped = position.flipped;
		label(this.grid, this.flipped);
		this.pieces = piecesOf(position.fen);
		this.nodes.clear();
		this.layer.replaceChildren(...this.pieces.map((piece) => this.draw(piece)));
		this.decorate(position);
	}

	async animate(
		moves: readonly string[],
		position: Position,
		milliseconds: number,
		landed?: (move: number) => void,
	): Promise<void> {
		this.element.style.setProperty("--motion", `${String(milliseconds)}ms`);
		this.arrows.replaceChildren();
		if (position.flipped !== this.flipped) {
			this.show(position);
			return;
		}
		for (const [index, move] of moves.entries()) {
			await this.step(move, milliseconds);
			landed?.(index);
		}
		if (samePlaces(this.pieces, piecesOf(position.fen))) this.decorate(position);
		else this.show(position);
	}

	private place(node: HTMLElement, square: string): void {
		node.style.setProperty("--x", String(columnOf(square, this.flipped)));
		node.style.setProperty("--y", String(rowOf(square, this.flipped)));
	}

	private paint(node: HTMLElement, piece: Piece): void {
		node.style.backgroundImage = `url("${this.images[`${piece.color}${piece.kind.toUpperCase()}`] ?? ""}")`;
		node.dataset["piece"] = `${piece.color}${piece.kind}`;
	}

	private draw(piece: Piece): HTMLElement {
		const node = layer(this.document, "piece");
		this.paint(node, piece);
		this.place(node, piece.square);
		this.nodes.set(piece.id, node);
		return node;
	}

	private mark(square: string, kind: string): HTMLElement {
		const node = layer(this.document, `mark ${kind}`);
		this.place(node, square);
		return node;
	}

	private decorate(position: Position): void {
		const check = position.check === null ? [] : [this.mark(position.check, "check")];
		this.marks.replaceChildren(...position.last.map((square) => this.mark(square, "last")), ...check);
		this.arrows.replaceChildren(
			...position.arrows.map((arrow) => {
				const shape = this.document.createElementNS(SVG, "polygon");
				shape.setAttribute("points", arrowPoints(arrow, this.flipped));
				shape.setAttribute("class", arrow.chosen ? "arrow chosen" : "arrow");
				const title = this.document.createElementNS(SVG, "title");
				title.textContent = arrow.label;
				shape.append(title);
				return shape;
			}),
		);
		const chosen = position.arrows.find((arrow) => arrow.chosen);
		this.element.setAttribute(
			"aria-label",
			chosen === undefined ? "Chess board" : `Chess board; the model chose ${chosen.label}`,
		);
	}

	/** Moves the pieces of one move, lets them glide, then takes the captured piece away and repaints a promotion. */
	private async step(move: string, milliseconds: number): Promise<void> {
		const motion = play(this.pieces, move);
		for (const { id, to } of motion.moved) this.moveNode(id, to);
		for (const id of motion.taken) this.nodes.get(id)?.classList.add("taken");
		await wait(milliseconds);
		for (const id of motion.taken) this.removeNode(id);
		for (const { id } of motion.promoted) {
			const piece = motion.pieces.find((found) => found.id === id);
			if (piece !== undefined) this.repaint(piece);
		}
		this.pieces = [...motion.pieces];
	}

	private moveNode(id: number, square: string): void {
		const node = this.nodes.get(id);
		if (node !== undefined) this.place(node, square);
	}

	private removeNode(id: number): void {
		this.nodes.get(id)?.remove();
		this.nodes.delete(id);
	}

	private repaint(piece: Piece): void {
		const node = this.nodes.get(piece.id);
		if (node !== undefined) this.paint(node, piece);
	}
}

/** A chess board in `document`. `images` maps wK, bQ and the other pieces to image URLs. */
export function createBoard(document: Document, images: Readonly<Record<string, string>>): BoardView {
	return new ChessBoard(document, images);
}

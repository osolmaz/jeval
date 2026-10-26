import { Chess, type PieceSymbol } from "chess.js";
import { z } from "zod";
import { stepSchema } from "./game.ts";

/** One move on the menu, as a viewer reads it from the trace. */
export interface BoardOption {
	readonly data: unknown;
	readonly probability: number | null;
	readonly chosen: boolean;
}

export interface BoardInput {
	/** The data of the last step before the choice: the position the model chose in. */
	readonly position: unknown;
	readonly options: readonly BoardOption[];
}

const SQUARE = 56;
const EDGE = 22;
const BOARD = 8 * SQUARE;
const LIGHT = "#EFE6D2";
const DARK = "#BFAE8E";
const INK = "#111111";
const MUTED = "#6F6656";
/** How many of the likeliest moves get an arrow; the chosen move always gets one. */
const ARROWS = 5;
/** The solid glyphs for both sides, drawn white or black; U+FE0E asks for text glyphs, not emoji. */
const GLYPHS: Readonly<Record<PieceSymbol, string>> = {
	k: "♚︎",
	q: "♛︎",
	r: "♜︎",
	b: "♝︎",
	n: "♞︎",
	p: "♟︎",
};
const square = z.string().regex(/^[a-h][1-8]$/);
const optionSchema = z.object({ from: square, to: square, san: z.string().regex(/^[KQRBNa-hx1-8=+#O-]+$/) });

interface Point {
	readonly x: number;
	readonly y: number;
}

/** The middle of a square on the picture, with the model's side at the bottom. */
function center(name: string, flipped: boolean): Point {
	const file = name.charCodeAt(0) - 97;
	const rank = Number(name[1]);
	const column = flipped ? 7 - file : file;
	const row = flipped ? rank - 1 : 8 - rank;
	return { x: EDGE + column * SQUARE + SQUARE / 2, y: row * SQUARE + SQUARE / 2 };
}

function squares(flipped: boolean, marked: ReadonlySet<string>): string {
	const parts: string[] = [];
	for (let file = 0; file < 8; file += 1) {
		for (let rank = 1; rank <= 8; rank += 1) {
			const name = `${String.fromCharCode(97 + file)}${String(rank)}`;
			const { x, y } = center(name, flipped);
			const fill = (file + rank) % 2 === 1 ? DARK : LIGHT;
			const corner = `x="${String(x - SQUARE / 2)}" y="${String(y - SQUARE / 2)}" width="${String(SQUARE)}" height="${String(SQUARE)}"`;
			parts.push(`<rect ${corner} fill="${fill}"/>`);
			if (marked.has(name)) parts.push(`<rect ${corner} fill="${INK}" fill-opacity="0.14"/>`);
		}
	}
	return parts.join("");
}

function labels(flipped: boolean): string {
	const parts: string[] = [];
	for (let index = 0; index < 8; index += 1) {
		const file = String.fromCharCode(97 + index);
		const rank = String(index + 1);
		const { x } = center(`${file}1`, flipped);
		const { y } = center(`a${rank}`, flipped);
		parts.push(`<text x="${String(x)}" y="${String(BOARD + 16)}" text-anchor="middle">${file}</text>`);
		parts.push(`<text x="${String(EDGE / 2)}" y="${String(y + 4)}" text-anchor="middle">${rank}</text>`);
	}
	return `<g font-size="12" fill="currentColor" font-family="Inter, Helvetica, Arial, sans-serif">${parts.join("")}</g>`;
}

function pieces(fen: string, flipped: boolean): string {
	const glyphs = new Chess(fen)
		.board()
		.flat()
		.flatMap((piece) => {
			if (piece === null) return [];
			const { x, y } = center(piece.square, flipped);
			const paint = piece.color === "w" ? `fill="#FFFFFF" stroke="${INK}" stroke-width="2"` : `fill="${INK}"`;
			return [
				`<text x="${String(x)}" y="${String(y + 2)}" ${paint} paint-order="stroke" text-anchor="middle" dominant-baseline="central">${GLYPHS[piece.type]}</text>`,
			];
		});
	const fonts = `"DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", sans-serif`;
	return `<g font-size="44" font-family='${fonts}'>${glyphs.join("")}</g>`;
}

/** An arrow from one square to another as one shape, as wide as the model's probability for the move is high. */
function arrow(from: Point, to: Point, probability: number, chosen: boolean, title: string): string {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
	const across = { x: -along.y, y: along.x };
	const width = 3 + 14 * probability;
	const head = { length: 12 + 1.2 * width, half: 7 + 0.9 * width };
	const base = { x: to.x - along.x * head.length, y: to.y - along.y * head.length };
	const at = (point: Point, side: number): string =>
		`${(point.x + across.x * side).toFixed(1)},${(point.y + across.y * side).toFixed(1)}`;
	const points = [
		at(from, width / 2),
		at(base, width / 2),
		at(base, head.half),
		at(to, 0),
		at(base, -head.half),
		at(base, -width / 2),
		at(from, -width / 2),
	];
	const paint = chosen ? `fill="${INK}" fill-opacity="0.82"` : `fill="${MUTED}" fill-opacity="0.5"`;
	return `<polygon points="${points.join(" ")}" ${paint}><title>${title}</title></polygon>`;
}

function arrows(options: readonly BoardOption[], flipped: boolean): string {
	const moves = options.flatMap((option) => {
		const parsed = optionSchema.safeParse(option.data);
		return parsed.success ? [{ ...parsed.data, probability: option.probability ?? 0, chosen: option.chosen }] : [];
	});
	const likeliest = [...moves].sort((a, b) => b.probability - a.probability).slice(0, ARROWS);
	const shown = [...likeliest.filter((move) => !move.chosen), ...moves.filter((move) => move.chosen)];
	return shown
		.map((move) => {
			const title = `${move.san}: ${(move.probability * 100).toFixed(1)}%`;
			return arrow(center(move.from, flipped), center(move.to, flipped), move.probability, move.chosen, title);
		})
		.join("");
}

/**
 * The position the model chose in, from its side, with the last move marked and arrows for its likeliest moves:
 * the chosen one dark, the others light. Empty when the position cannot be read.
 */
export function boardPicture(input: BoardInput): string {
	const position = stepSchema.safeParse(input.position);
	if (!position.success) return "";
	const { fen, moves, you } = position.data;
	const flipped = you === "black";
	const last = moves.at(-1);
	const marked = new Set(last === undefined ? [] : [last.slice(0, 2), last.slice(2, 4)]);
	const size = `${String(EDGE + BOARD)} ${String(BOARD + EDGE)}`;
	return [
		`<svg class="board" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size}" role="img" aria-label="The board as the model saw it, with arrows for its likeliest moves">`,
		squares(flipped, marked),
		labels(flipped),
		pieces(fen, flipped),
		arrows(input.options, flipped),
		"</svg>",
	].join("");
}

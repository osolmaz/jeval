/** The chess part's model of a game, in the browser and in tests: no DOM here. */
import type { Session, Story } from "@osolmaz/switch/page";
import { type ChessState, chessState, movesOfStep } from "./data.ts";

export type Color = "w" | "b";
export type Kind = "k" | "q" | "r" | "b" | "n" | "p";
export interface Piece {
	readonly id: number;
	readonly color: Color;
	readonly kind: Kind;
	readonly square: string;
}

/** The pieces of a FEN position, numbered in reading order from a8 to h1. */
export function piecesOf(fen: string): Piece[] {
	const pieces: Piece[] = [];
	(fen.split(" ")[0] ?? "").split("/").forEach((row, index) => {
		let file = 0;
		for (const char of row) {
			const empty = Number(char);
			if (empty > 0) {
				file += empty;
				continue;
			}
			const square = `${String.fromCharCode(97 + file)}${String(8 - index)}`;
			const color = char === char.toUpperCase() ? "w" : "b";
			pieces.push({ id: pieces.length, color, kind: char.toLowerCase() as Kind, square });
			file += 1;
		}
	});
	return pieces;
}

/** How one move changes the pieces: who goes where, who is taken, and a promoted pawn's new kind. */
export interface Motion {
	readonly pieces: readonly Piece[];
	readonly moved: readonly { readonly id: number; readonly to: string }[];
	readonly taken: readonly number[];
	readonly promoted: readonly { readonly id: number; readonly kind: Kind }[];
}

const shift = (square: string, files: number): string =>
	`${String.fromCharCode(square.charCodeAt(0) + files)}${square.slice(1)}`;

/** The rook that castling moves with the king: from the corner to beside the king. */
function castlingRook(from: string, to: string): { from: string; to: string } {
	return to > from
		? { from: `h${from.slice(1)}`, to: shift(to, -1) }
		: { from: `a${from.slice(1)}`, to: shift(to, 1) };
}

/** The square of the pawn an en-passant capture takes: beside the moving pawn, where it started. */
const passedPawn = (from: string, to: string): string => `${to.slice(0, 1)}${from.slice(1)}`;

const at = (pieces: readonly Piece[], square: string): Piece | undefined =>
	pieces.find((piece) => piece.square === square);

/** The piece a move takes: the one on its target square, or the pawn an en-passant capture passes. */
function takenBy(pieces: readonly Piece[], mover: Piece, from: string, to: string): Piece | undefined {
	const target = at(pieces, to);
	if (target !== undefined || mover.kind !== "p" || to.startsWith(from.charAt(0))) return target;
	return at(pieces, passedPawn(from, to));
}

/** Every piece a move carries: the mover, and the rook when the king castles. */
function carried(pieces: readonly Piece[], mover: Piece, from: string, to: string): { id: number; to: string }[] {
	const moved = [{ id: mover.id, to }];
	if (mover.kind !== "k" || Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) !== 2) return moved;
	const rook = castlingRook(from, to);
	const found = at(pieces, rook.from);
	return found === undefined ? moved : [...moved, { id: found.id, to: rook.to }];
}

/** Plays a move in long algebraic notation, such as e2e4 or a7a8q, on the pieces. */
export function play(pieces: readonly Piece[], lan: string): Motion {
	const from = lan.slice(0, 2);
	const to = lan.slice(2, 4);
	const mover = at(pieces, from);
	if (mover === undefined) return { pieces, moved: [], taken: [], promoted: [] };
	const moved = carried(pieces, mover, from, to);
	const taken = takenBy(pieces, mover, from, to);
	const promoted = lan.length > 4 ? [{ id: mover.id, kind: lan.slice(4, 5) as Kind }] : [];
	const after = pieces
		.filter((piece) => piece.id !== taken?.id)
		.map((piece) => {
			const square = moved.find((move) => move.id === piece.id)?.to ?? piece.square;
			const kind = promoted.find((change) => change.id === piece.id)?.kind ?? piece.kind;
			return { ...piece, square, kind };
		});
	return { pieces: after, moved, taken: taken === undefined ? [] : [taken.id], promoted };
}

/** Whether two sets of pieces stand on the same squares as the same kinds, whatever their numbers. */
export function samePlaces(a: readonly Piece[], b: readonly Piece[]): boolean {
	const key = (pieces: readonly Piece[]) =>
		pieces
			.map((piece) => `${piece.square}${piece.color}${piece.kind}`)
			.sort()
			.join(" ");
	return key(a) === key(b);
}

const VALUES: Readonly<Record<Kind, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL_SET: Readonly<Record<Kind, number>> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const ORDER: readonly Kind[] = ["q", "r", "b", "n", "p"];

/** The pieces each side has lost, most valuable first, and white's material lead in points. */
export function captures(fen: string): { readonly lost: Record<Color, Kind[]>; readonly lead: number } {
	const pieces = piecesOf(fen);
	const lost: Record<Color, Kind[]> = { w: [], b: [] };
	let lead = 0;
	for (const color of ["w", "b"] as const) {
		for (const kind of ORDER) {
			const left = pieces.filter((piece) => piece.color === color && piece.kind === kind).length;
			for (let count = left; count < FULL_SET[kind]; count += 1) lost[color].push(kind);
			lead += (color === "w" ? 1 : -1) * left * VALUES[kind];
		}
	}
	return { lost, lead };
}

/** One half-move of the game, as the move list shows it. */
export interface Ply {
	readonly san: string;
	readonly color: Color;
	readonly number: number;
	readonly byModel: boolean;
	/** The model's probability for its move; null for the opponent's moves. */
	readonly probability: number | null;
	/** The moment to open when the move is picked: the model's decision, or the position after the reply. */
	readonly moment: number;
	/** The first moment whose position has the move on the board. */
	readonly shown: number;
}

/** The color and number of the half-move `back` half-moves before the one that `fen` has to play. */
function numbering(fen: string, back: number): { color: Color; number: number } {
	const fields = fen.split(" ");
	const half = 2 * (Number(fields[5] ?? "1") - 1) + (fields[1] === "b" ? 1 : 0) - back;
	return { color: half % 2 === 0 ? "w" : "b", number: Math.floor(half / 2) + 1 };
}

/** The game's initial state; null for a story without chess states. */
export const initialOf = (story: Story): ChessState | null => chessState(story.initial);

/** Every move of the game in order, from the initial state and each step. */
export function pliesOf(story: Story): Ply[] {
	const initial = initialOf(story);
	if (initial === null) return [];
	const moves: Omit<Ply, "color" | "number">[] = [];
	for (const san of initial.san) moves.push({ san, byModel: false, probability: null, moment: 0, shown: 0 });
	story.frames.forEach((frame, index) => {
		const step = movesOfStep(chessState(frame.before), chessState(frame.after));
		const picked = frame.choices.find((choice) => choice.picked)?.probability ?? null;
		step.san.forEach((san, ply) => {
			const byModel = ply === 0;
			const moment = index + (byModel ? 1 : 2);
			moves.push({ san, byModel, probability: byModel ? picked : null, moment, shown: index + 2 });
		});
	});
	const first = numbering(initial.fen, initial.san.length);
	return moves.map((move, index) => {
		const half = 2 * (first.number - 1) + (first.color === "b" ? 1 : 0) + index;
		return { ...move, color: half % 2 === 0 ? "w" : "b", number: Math.floor(half / 2) + 1 };
	});
}

/** The score of each result, by the side the model plays: its own result, or the winner's color in self-play. */
const RESULTS: Readonly<Record<string, Readonly<Record<ChessState["you"], string>>>> = {
	win: { white: "1-0", black: "0-1", both: "*" },
	loss: { white: "0-1", black: "1-0", both: "*" },
	draw: { white: "1/2-1/2", black: "1/2-1/2", both: "1/2-1/2" },
	"white wins": { white: "1-0", black: "1-0", both: "1-0" },
	"black wins": { white: "0-1", black: "0-1", both: "0-1" },
};

const STANDARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w";

/** The players of the game by color, and its start position. */
function players(story: Story): { white: string; black: string; start: string } {
	const initial = initialOf(story);
	if (initial === null) return { white: story.model, black: "opponent", start: STANDARD };
	const opponent = initial.opponent === "itself" ? story.model : initial.opponent;
	const [white, black] = initial.you === "black" ? [opponent, story.model] : [story.model, opponent];
	return { white, black, start: initial.start };
}

function pgnHeaders(story: Story, result: string): [string, string][] {
	const { white, black, start } = players(story);
	const headers: [string, string][] = [
		["Event", `switch: ${story.case}`],
		["White", white],
		["Black", black],
		["Result", result],
	];
	return start.startsWith(STANDARD) ? headers : [...headers, ["SetUp", "1"], ["FEN", start]];
}

/** The game's result in PGN: 1-0, 0-1 or 1/2-1/2, or * while it is not over. */
function pgnResult(session: Session): string {
	const you = initialOf(session.story)?.you ?? "white";
	return RESULTS[String(session.outcome?.["result"])]?.[you] ?? "*";
}

/** A chess game's score once it is over, such as 1-0; null for a session without chess states or a game not over. */
export function scoreOf(session: Session): string | null {
	if (initialOf(session.story) === null) return null;
	const score = pgnResult(session);
	return score === "*" ? null : score;
}

/** The game in PGN, with the model and the opponent as the players. */
export function pgnOf(session: Session): string {
	const result = pgnResult(session);
	const moves = pliesOf(session.story).map((ply, index) => {
		if (ply.color === "w") return `${String(ply.number)}. ${ply.san}`;
		return index === 0 ? `${String(ply.number)}... ${ply.san}` : ply.san;
	});
	const tags = pgnHeaders(session.story, result).map(([key, value]) => `[${key} "${value.replace(/["\\]/g, "")}"]`);
	return `${tags.join("\n")}\n\n${[...moves, result].join(" ")}\n`;
}

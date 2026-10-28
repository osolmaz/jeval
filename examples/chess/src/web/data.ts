/**
 * The chess state, which the domain writes and the page reads, and the checks that read it back. Both use this one
 * module; it imports only types, so it runs in the browser as is.
 */
import type { JsonObject } from "@osolmaz/switch/page";

/** Where a game is after some steps. */
export interface ChessState extends JsonObject {
	/** The side that the model plays, or both in self-play. */
	readonly you: "white" | "black" | "both";
	/** The opponent's name, for the viewer. */
	readonly opponent: string;
	/** The position the game started from, in FEN. */
	readonly start: string;
	/** Every move so far, of both sides: in long algebraic notation such as e2e4 or a7a8q, and in SAN. */
	readonly moves: readonly string[];
	readonly san: readonly string[];
	/** The position now. */
	readonly fen: string;
	readonly status: string;
	readonly check: boolean;
	/** What the last step did, such as "You played e4. The opponent played e5.". */
	readonly last: string;
}

/** A move among the choices. */
export interface ChessChoice {
	readonly from: string;
	readonly to: string;
	readonly san: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");
const SQUARE = /^[a-h][1-8]$/;

const isSide = (value: unknown): boolean => value === "white" || value === "black" || value === "both";
const isPosition = ({ fen, status, check }: Record<string, unknown>): boolean =>
	typeof fen === "string" && typeof status === "string" && typeof check === "boolean";
const isGame = ({ opponent, start, last }: Record<string, unknown>): boolean =>
	typeof opponent === "string" && typeof start === "string" && typeof last === "string";

/** A chess state, or null when `value` is not one. */
export function chessState(value: unknown): ChessState | null {
	if (!isRecord(value) || !isSide(value["you"]) || !isPosition(value) || !isGame(value)) return null;
	return strings(value["moves"]) && strings(value["san"]) ? (value as unknown as ChessState) : null;
}

/** A choice's move, or null when `data` is not a move. */
export function chessChoice(data: unknown): ChessChoice | null {
	if (!isRecord(data)) return null;
	const { from, to, san } = data;
	if (typeof from !== "string" || typeof to !== "string" || typeof san !== "string") return null;
	return SQUARE.test(from) && SQUARE.test(to) ? { from, to, san } : null;
}

/** The moves of a step: the entries that the state after it added to the state before it. */
export function movesOfStep(
	before: ChessState | null,
	after: ChessState | null,
): { readonly lan: readonly string[]; readonly san: readonly string[] } {
	if (after === null) return { lan: [], san: [] };
	const played = before?.moves.length ?? 0;
	return { lan: after.moves.slice(played), san: after.san.slice(played) };
}

/**
 * The data that the chess domain writes for each step and each choice, and the checks that read it back. The domain
 * writes it and the page reads it, so both use this one module; it imports nothing, so it runs in the browser as is.
 */

/** What the chess domain records for a step. `you` is the side the model plays, or both in self-play. */
export interface ChessStepData {
	readonly you: "white" | "black" | "both";
	/** The moves of this step, in long algebraic notation such as e2e4 or a7a8q. */
	readonly moves: readonly string[];
	readonly san: readonly string[];
	/** The position after the step. */
	readonly fen: string;
	readonly status: string;
	readonly check: boolean;
	/** The opponent's name, in the first step only. */
	readonly opponent?: string;
	/** The start position, in the first step only. */
	readonly start?: string;
}

/** A move on a chess menu. */
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

/** A step's chess data, or null when `data` is not chess data. */
export function chessStep(data: unknown): ChessStepData | null {
	if (!isRecord(data) || !isSide(data["you"]) || !isPosition(data)) return null;
	return strings(data["moves"]) && strings(data["san"]) ? (data as unknown as ChessStepData) : null;
}

/** A menu choice's move, or null when `data` is not a move. */
export function chessChoice(data: unknown): ChessChoice | null {
	if (!isRecord(data)) return null;
	const { from, to, san } = data;
	if (typeof from !== "string" || typeof to !== "string" || typeof san !== "string") return null;
	return SQUARE.test(from) && SQUARE.test(to) ? { from, to, san } : null;
}

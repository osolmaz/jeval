import { describe, expect, it } from "vitest";
import { chessChoice, chessStep } from "../../../src/domains/chess/web/data.ts";
import { captures, pgnOf, piecesOf, play, pliesOf, samePlaces, scoreOf } from "../../../src/domains/chess/web/model.ts";
import { confidence } from "../../../src/view/web/model.ts";
import { picking } from "../../helpers/chess.ts";
import { chessSession } from "../../helpers/sessions.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const squaresOf = (fen: string) => piecesOf(fen).map((piece) => `${piece.color}${piece.kind}${piece.square}`);

describe("chess data", () => {
	it("reads a step and a choice only when every field is there", () => {
		const step = { you: "white", moves: [], san: [], fen: START, status: "playing", check: false };
		expect(chessStep(step)).toEqual(step);
		expect(chessStep({ ...step, you: "red" })).toBeNull();
		expect(chessStep({ ...step, moves: [1] })).toBeNull();
		expect(chessStep({ ...step, check: "no" })).toBeNull();
		expect(chessStep(null)).toBeNull();
		expect(chessChoice({ from: "e2", to: "e4", san: "e4" })).toEqual({ from: "e2", to: "e4", san: "e4" });
		expect(chessChoice({ from: "e9", to: "e4", san: "e4" })).toBeNull();
		expect(chessChoice({ from: "e2", san: "e4" })).toBeNull();
		expect(chessChoice("e2e4")).toBeNull();
	});

	it("is what the domain writes: the page reads every step of a game", async () => {
		const session = await chessSession({ steps: 2 });
		expect(chessStep(session.story.opening[0]?.data)).toMatchObject({
			you: "white",
			opponent: "random legal moves, seed 7",
		});
		expect(session.story.frames.map((frame) => chessStep(frame.after?.data)?.moves.length)).toEqual([2, 2]);
		expect(session.story.frames[0]?.choices.filter((choice) => chessChoice(choice.data) !== null)).toHaveLength(20);
	});
});

describe("piece motion", () => {
	it("reads the pieces of a position in reading order", () => {
		const pieces = piecesOf(START);
		expect(pieces).toHaveLength(32);
		expect(pieces[0]).toEqual({ id: 0, color: "b", kind: "r", square: "a8" });
		expect(pieces.at(-1)).toEqual({ id: 31, color: "w", kind: "r", square: "h1" });
	});

	it("moves a piece and takes the one on its target square", () => {
		const motion = play(piecesOf("k7/8/8/3p4/4P3/8/8/K7 w - - 0 1"), "e4d5");
		expect(motion.moved).toHaveLength(1);
		expect(motion.taken).toHaveLength(1);
		expect(squaresOf("k7/8/8/3P4/8/8/8/K7 b - - 0 1").sort()).toEqual(
			motion.pieces.map((piece) => `${piece.color}${piece.kind}${piece.square}`).sort(),
		);
	});

	it("carries the rook when the king castles, on either side", () => {
		const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
		const short = play(piecesOf(fen), "e1g1");
		expect(short.moved.map((move) => move.to)).toEqual(["g1", "f1"]);
		const long = play(piecesOf(fen), "e1c1");
		expect(long.moved.map((move) => move.to)).toEqual(["c1", "d1"]);
	});

	it("takes the passed pawn en passant, and changes a promoted pawn's kind", () => {
		const passant = play(piecesOf("k7/8/8/3pP3/8/8/8/K7 w - d6 0 1"), "e5d6");
		expect(passant.taken).toHaveLength(1);
		expect(samePlaces(passant.pieces, piecesOf("k7/8/3P4/8/8/8/8/K7 b - - 0 1"))).toBe(true);
		const promotion = play(piecesOf("k7/4P3/8/8/8/8/8/K7 w - - 0 1"), "e7e8q");
		expect(promotion.promoted).toEqual([{ id: 1, kind: "q" }]);
		expect(promotion.pieces.find((piece) => piece.id === 1)).toMatchObject({ kind: "q", square: "e8" });
	});

	it("changes nothing for a move from an empty square", () => {
		const pieces = piecesOf(START);
		expect(play(pieces, "e4e5")).toEqual({ pieces, moved: [], taken: [], promoted: [] });
	});

	it("compares positions by squares and kinds, not by numbers", () => {
		expect(samePlaces(piecesOf(START), [...piecesOf(START)].reverse())).toBe(true);
		expect(samePlaces(piecesOf(START), piecesOf("k7/8/8/8/8/8/8/K7 w - - 0 1"))).toBe(false);
	});

	it("counts the pieces each side has lost and white's lead", () => {
		expect(captures(START)).toEqual({ lost: { w: [], b: [] }, lead: 0 });
		expect(captures("4k3/8/8/8/8/8/8/R3K3 w - - 0 1")).toEqual({
			lost: {
				w: ["q", "r", "b", "b", "n", "n", "p", "p", "p", "p", "p", "p", "p", "p"],
				b: ["q", "r", "r", "b", "b", "n", "n", "p", "p", "p", "p", "p", "p", "p", "p"],
			},
			lead: 5,
		});
	});
});

describe("the move list and the PGN", () => {
	it("numbers the moves and marks the model's with its probability", async () => {
		const session = await chessSession({ steps: 2 });
		const plies = pliesOf(session.story);
		expect(plies.map((ply) => [ply.color, ply.number, ply.byModel, ply.moment, ply.shown])).toEqual([
			["w", 1, true, 1, 2],
			["b", 1, false, 2, 2],
			["w", 2, true, 2, 3],
			["b", 2, false, 3, 3],
		]);
		expect(plies[0]?.probability).toBe(0.6);
		expect(confidence(session.story)).toEqual([0.6, 0.6]);
	});

	it("starts with the opponent's first move when the model plays black", async () => {
		const session = await chessSession({ side: "black", steps: 1 });
		const plies = pliesOf(session.story);
		expect(plies.map((ply) => [ply.color, ply.number, ply.byModel, ply.moment])).toEqual([
			["w", 1, false, 0],
			["b", 1, true, 1],
			["w", 2, false, 2],
		]);
	});

	it("has no moves without a chess opening", async () => {
		const session = await chessSession({ steps: 1 });
		expect(pliesOf({ ...session.story, opening: [] })).toEqual([]);
	});

	it("writes the game as PGN with the players, the result and a set-up position", async () => {
		const won = await chessSession({ start: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", policy: picking(/checkmate/) });
		const pgn = pgnOf(won);
		expect(pgn).toContain('[White "fake/decider"]');
		expect(pgn).toContain('[Black "random legal moves, seed 7"]');
		expect(pgn).toContain('[Result "1-0"]');
		expect(pgn).toContain('[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"]');
		expect(pgn.trimEnd().endsWith("1. Rd8# 1-0")).toBe(true);
		const running = await chessSession({ side: "black", steps: 1, finished: false });
		const open = pgnOf(running);
		expect(open).toContain('[White "random legal moves, seed 7"]');
		expect(open).not.toContain("SetUp");
		expect(open.trimEnd().endsWith("*")).toBe(true);
	});

	it("has the model on both sides of a self-play game, and gives the winner's score", async () => {
		const mate = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
		const won = await chessSession({ opponent: "self", start: mate, policy: picking(/checkmate/) });
		const pgn = pgnOf(won);
		expect(pgn).toContain('[White "fake/decider"]');
		expect(pgn).toContain('[Black "fake/decider"]');
		expect(pgn).toContain('[Result "1-0"]');
		expect(scoreOf(won)).toBe("1-0");
		const played = await chessSession({ opponent: "self", steps: 2 });
		expect(pliesOf(played.story).map((ply) => [ply.color, ply.byModel])).toEqual([
			["w", true],
			["b", true],
		]);
	});

	it("has no score for a game that is not over or a case that is not chess", async () => {
		const running = await chessSession({ steps: 1, finished: false });
		expect(scoreOf(running)).toBeNull();
		expect(scoreOf({ ...running, story: { ...running.story, opening: [] } })).toBeNull();
		const lost = await chessSession({ side: "black", steps: 1 });
		expect(scoreOf({ ...lost, outcome: { result: "loss" } })).toBe("1-0");
		expect(scoreOf({ ...lost, outcome: { result: "draw" } })).toBe("1/2-1/2");
	});

	it("names the model's opponent as such when the opening says nothing about it", async () => {
		const session = await chessSession({ steps: 1 });
		expect(pgnOf({ ...session, story: { ...session.story, opening: [] } })).toContain('[Black "opponent"]');
	});
});

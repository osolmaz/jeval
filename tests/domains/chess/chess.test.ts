import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { replayOf, run, type State } from "../../../src/core/index.ts";
import {
	caseSchema,
	chess,
	type ChessCase,
	type Engine,
	EngineError,
	LIMITS,
	outcomeOf,
	STANDARD_START,
} from "../../../src/domains/chess/index.ts";
import { materialOf, movesOf, opponentMove, replay, statusOf, unitOf } from "../../../src/domains/chess/game.ts";
import { describe as describeMove, move } from "../../../src/domains/chess/move.ts";
import { chessView, numbered } from "../../../src/domains/chess/view.ts";
import { game, logOf, picking } from "../../helpers/chess.ts";
import { fakeDecider } from "../../helpers/fakes.ts";

const MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
const STALEMATE_IN_ONE = "k7/8/2Q5/8/8/8/8/7K w - - 0 1";

/** An engine that plays the first legal move, named Fake 1. */
const FIRST_MOVE: Engine = {
	name: "Fake 1",
	move: (fen) => Promise.resolve(new Chess(fen).moves({ verbose: true })[0]?.lan ?? "(none)"),
};

const stateOf = (workspace: ChessCase, log: State<ChessCase>["log"] = []): State<ChessCase> => ({ workspace, log });
const menuOf = (state: State<ChessCase>) => move.items(state);

describe("chess cases", () => {
	it("play white against the random opponent with seed 0 unless the case says otherwise", () => {
		expect(caseSchema.parse({ id: "g" })).toMatchObject({
			opponent: "random",
			side: "white",
			seed: 0,
			movetime: 1000,
		});
	});

	it("start from the standard position unless the case gives one", () => {
		expect(game().start).toBe(STANDARD_START);
		expect(game({ start: MATE_IN_ONE }).start).toBe(MATE_IN_ONE);
	});

	it("refuse a position that is not valid FEN", () => {
		expect(() => caseSchema.parse({ id: "g", side: "white", seed: 1, start: "not a position" })).toThrow(
			/not a valid FEN/,
		);
	});
});

describe("the game", () => {
	it("draws the same number from the same text, between 0 and 1", () => {
		expect(unitOf("7:e2e4")).toBe(unitOf("7:e2e4"));
		expect(unitOf("7:e2e4")).not.toBe(unitOf("8:e2e4"));
		for (const text of ["", "a", "1:e2e4 e7e5"]) {
			expect(unitOf(text)).toBeGreaterThanOrEqual(0);
			expect(unitOf(text)).toBeLessThan(1);
		}
	});

	it("has the opponent play the same legal move for the same seed and moves", () => {
		const first = opponentMove(new Chess(), 3, [])?.lan;
		expect(first).toBe(opponentMove(new Chess(), 3, [])?.lan);
		expect(new Chess().moves({ verbose: true }).map((legal) => legal.lan)).toContain(first);
	});

	it("names how a game ended", () => {
		expect(statusOf(new Chess())).toBe("playing");
		expect(statusOf(replay(STANDARD_START, ["f2f3", "e7e5", "g2g4", "d8h4"]))).toBe("checkmate");
		expect(statusOf(new Chess("k7/8/1Q6/8/8/8/8/7K b - - 0 1"))).toBe("stalemate");
		expect(statusOf(new Chess("k7/8/8/8/8/8/8/7K w - - 0 1"))).toBe("insufficient material");
		expect(statusOf(new Chess("k7/8/8/8/8/8/R7/7K w - - 100 80"))).toBe("fifty-move rule");
		const repeated = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
		expect(statusOf(replay(STANDARD_START, repeated))).toBe("threefold repetition");
	});

	it("counts material and reads the moves back from the log", () => {
		expect(materialOf(new Chess())).toEqual({ white: 39, black: 39 });
		const log = [
			...logOf("white", ["e2e4", "e7e5"]),
			{ action: "note", key: "n", observation: { source: "x", text: "" } },
		];
		expect(movesOf(log)).toEqual(["e2e4", "e7e5"]);
	});
});

describe("the move action", () => {
	it("offers every legal move with a unique key, words for the model and squares for the viewer", () => {
		const items = menuOf(stateOf(game()));
		expect(items).toHaveLength(20);
		expect(items.find((item) => item.key === "move:0:e2e4")).toMatchObject({
			text: "e4 (pawn e2 to e4)",
			data: { from: "e2", to: "e4", san: "e4" },
		});
	});

	it("offers nothing once the game is over", () => {
		const over = game({ start: "k7/8/1Q6/8/8/8/8/7K b - - 0 1", side: "black" });
		expect(menuOf(stateOf(over))).toEqual([]);
	});

	it("plays the move and the opponent's reply, and records both", async () => {
		const workspace = game();
		const item = menuOf(stateOf(workspace)).find((option) => option.key === "move:0:e2e4");
		const observation = await item?.run();
		const reply = opponentMove(replay(workspace.start, ["e2e4"]), workspace.seed, ["e2e4"]);
		expect(observation?.text).toBe(`You played e4. The opponent played ${reply?.san ?? "?"}.`);
		expect(observation?.data).toMatchObject({ you: "white", moves: ["e2e4", reply?.lan], status: "playing" });
	});

	it("plays no reply after a move that ends the game", async () => {
		const items = menuOf(stateOf(game({ start: MATE_IN_ONE })));
		const observation = await items.find((item) => item.text.includes("checkmate"))?.run();
		expect(observation?.text).toBe("You played Rd8#. Checkmate: the game is over.");
		expect(observation?.data).toMatchObject({ moves: ["d1d8"], status: "checkmate", check: true });
	});

	it("says in words what a move does", () => {
		const castle = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").moves({ verbose: true });
		expect(castle.filter((legal) => legal.san.startsWith("O-O")).map(describeMove)).toEqual([
			"O-O (castle kingside)",
			"O-O-O (castle queenside)",
		]);
		const promote = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1").moves({ verbose: true });
		expect(promote.map(describeMove)).toContain("a8=Q+ (pawn a7 to a8, becomes a queen, check)");
		const take = new Chess("k7/8/8/3p4/4P3/8/8/K7 w - - 0 1").moves({ verbose: true });
		expect(take.map(describeMove)).toContain("exd5 (pawn e4 to d5, takes the pawn)");
	});
});

describe("the model's view", () => {
	it("numbers the moves from the start position", () => {
		expect(numbered(STANDARD_START, ["e4", "e5", "Nf3"])).toEqual(["1. e4", "e5", "2. Nf3"]);
		expect(numbered("k7/8/8/8/8/8/8/K7 b - - 0 7", ["Kb8", "Kb1"])).toEqual(["7... Kb8", "8. Kb1"]);
	});

	it("shows the board, both sides' pieces and the moves so far", () => {
		const view = chessView(stateOf(game(), logOf("white", ["e2e4", "e7e5"])), 10_000);
		expect(view.state).toMatchObject({
			you: "white",
			to_move: "white",
			in_check: false,
			moves: "1. e4 e5",
		});
		expect(view.state["board"]).toContain("4 . . . . P . . .");
		expect(view.state["your_pieces"]).toContain("Ke1");
		expect(view.state["opponent_pieces"]).toContain("Pe5");
		expect(view.omitted).toEqual([]);
	});

	it("keeps only the latest moves when the whole game does not fit", () => {
		const board = new Chess();
		const moves: string[] = [];
		for (let ply = 0; ply < 40; ply += 1) {
			const legal = board.moves({ verbose: true })[0];
			if (legal === undefined) break;
			moves.push(board.move(legal.lan).lan);
		}
		const view = chessView(stateOf(game(), logOf("white", moves)), 50);
		expect(view.state["moves"]).toEqual(expect.stringMatching(/^… /));
		expect(view.omitted).toEqual([`the first ${String(moves.length - 20)} moves of the game`]);
	});
});

describe("a game", () => {
	it("ends in a win when the model gives checkmate", async () => {
		const workspace = game({ start: MATE_IN_ONE });
		const result = await run(chess, workspace, fakeDecider(picking(/checkmate/)), { case: "g", limits: LIMITS });
		expect(result.steps).toBe(1);
		expect(result.answers).toEqual({});
		expect(outcomeOf(workspace, result.log, false)).toMatchObject({ result: "win", reason: "checkmate", moves: 1 });
	});

	it("ends in a draw at stalemate, in a loss on resignation, and unfinished at the move limit", async () => {
		const stalemate = game({ start: STALEMATE_IN_ONE });
		const drawn = await run(chess, stalemate, fakeDecider(picking(/^Qb6/)), { case: "g", limits: LIMITS });
		expect(outcomeOf(stalemate, drawn.log, false)).toMatchObject({ result: "draw", reason: "stalemate" });
		const resigned = await run(chess, game(), fakeDecider(picking("stop")), { case: "g", limits: LIMITS });
		expect(outcomeOf(game(), resigned.log, true)).toMatchObject({ result: "loss", reason: "resignation", moves: 0 });
		const short = await run(chess, game(), fakeDecider(picking()), {
			case: "g",
			limits: { ...LIMITS, steps: 2 },
		});
		expect(outcomeOf(game(), short.log, false)).toMatchObject({
			result: "unfinished",
			reason: "move limit",
			moves: 4,
		});
	});

	it("counts a checkmate against the model as a loss", () => {
		const log = logOf("white", ["f2f3", "e7e5", "g2g4", "d8h4"]);
		expect(outcomeOf(game(), log, false)).toMatchObject({ result: "loss", reason: "checkmate" });
	});

	it("lets the model play both sides in self-play, one move a step, from the side to move", async () => {
		const workspace = game({ opponent: "self" });
		const [opening] = await chess.start(workspace);
		expect(opening?.observation).toMatchObject({
			text: "The game starts. You play both sides.",
			data: { you: "both", opponent: "itself", moves: [] },
		});
		const log = opening === undefined ? [] : [opening];
		const first = await menuOf(stateOf(workspace, log))
			.find((item) => item.key === "move:0:e2e4")
			?.run();
		expect(first).toMatchObject({ text: "White played e4.", data: { you: "both", moves: ["e2e4"] } });
		const after = [...log, { action: "move", key: "move:0:e2e4", observation: first ?? { source: "", text: "" } }];
		expect(chessView(stateOf(workspace, after), 10_000).state).toMatchObject({ you: "black", to_move: "black" });
		expect(menuOf(stateOf(workspace, after)).map((item) => item.key)).toContain("move:1:e7e5");
	});

	it("names the winner in self-play: checkmate, resignation, a draw or the move limit", async () => {
		const mate = game({ opponent: "self", start: MATE_IN_ONE });
		const won = await run(chess, mate, fakeDecider(picking(/checkmate/)), { case: "g", limits: LIMITS });
		expect(outcomeOf(mate, won.log, false)).toMatchObject({ result: "white wins", reason: "checkmate", moves: 1 });
		const open = game({ opponent: "self" });
		const resigned = await run(chess, open, fakeDecider(picking("stop")), { case: "g", limits: LIMITS });
		expect(outcomeOf(open, resigned.log, true)).toMatchObject({ result: "black wins", reason: "resignation" });
		const stale = game({ opponent: "self", start: STALEMATE_IN_ONE });
		const drawn = await run(chess, stale, fakeDecider(picking(/^Qb6/)), { case: "g", limits: LIMITS });
		expect(outcomeOf(stale, drawn.log, false)).toMatchObject({ result: "draw", reason: "stalemate" });
		const short = await run(chess, open, fakeDecider(picking()), { case: "g", limits: { ...LIMITS, steps: 3 } });
		expect(outcomeOf(open, short.log, false)).toMatchObject({ result: "unfinished", moves: 3 });
	});

	it("lets the opponent move first when the model plays black", async () => {
		const workspace = game({ side: "black" });
		const [opening] = await chess.start(workspace);
		expect(opening?.observation.text).toMatch(/^The game starts\. You play black\. The opponent played \S+\.$/);
		expect(opening?.observation.data).toMatchObject({
			you: "black",
			status: "playing",
			opponent: "random legal moves, seed 7",
			start: STANDARD_START,
		});
		expect(menuOf(stateOf(workspace, opening === undefined ? [] : [opening]))).toHaveLength(20);
	});
});

describe("a game against an engine", () => {
	it("plays the engine's reply, and names the engine and its time a move", async () => {
		const workspace = { ...game({ opponent: "stockfish", movetime: 500 }), engine: FIRST_MOVE };
		const [opening] = await chess.start(workspace);
		expect(opening?.observation).toMatchObject({
			text: "The game starts. You play white.",
			data: { you: "white", opponent: "Fake 1, 0.5 s a move", moves: [] },
		});
		const item = menuOf(stateOf(workspace)).find((option) => option.key === "move:0:e2e4");
		const reply = await FIRST_MOVE.move(replay(workspace.start, ["e2e4"]).fen());
		const played = new Chess();
		played.move("e2e4");
		const san = played.move(reply).san;
		expect(await item?.run()).toMatchObject({
			text: `You played e4. The opponent played ${san}.`,
			data: { you: "white", moves: ["e2e4", reply] },
		});
	});

	it("lets the engine move first when the model plays black, and needs an engine", async () => {
		const black = game({ opponent: "stockfish", side: "black" });
		const [opening] = await chess.start({ ...black, engine: FIRST_MOVE });
		expect(opening?.observation.text).toMatch(/^The game starts\. You play black\. The opponent played \S+\.$/);
		expect(opening?.observation.data).toMatchObject({ opponent: "Fake 1, 1 s a move", moves: ["a2a3"] });
		await expect(chess.start(black)).rejects.toThrow(EngineError);
	});

	it("counts the result for the model, as against the random opponent", async () => {
		const workspace = { ...game({ opponent: "stockfish", start: MATE_IN_ONE }), engine: FIRST_MOVE };
		const won = await run(chess, workspace, fakeDecider(picking(/checkmate/)), { case: "g", limits: LIMITS });
		expect(outcomeOf(workspace, won.log, false)).toMatchObject({ result: "win", reason: "checkmate" });
	});

	it("replays the recorded game although the engine's replies change, and asks the engine only after a fork", async () => {
		const engine = restlessEngine();
		const workspace = { ...game({ opponent: "stockfish", side: "black" }), engine };
		const first = await run(chess, workspace, firstMoves(3), { case: "g", limits: LIMITS });
		const asked = engine.calls;
		expect(asked).toBe(4);

		const { decider, replay } = replayOf(first.trace.entries);
		const again = await run(chess, workspace, decider, { case: "g", limits: LIMITS, replay });
		expect(engine.calls).toBe(asked);
		expect(movesOf(again.log)).toEqual(movesOf(first.log));
		expect(again.ended).toBe("stop");

		const fork = replayOf(first.trace.entries, { steps: 1, then: firstMoves(1) });
		const forked = await run(chess, workspace, fork.decider, { case: "g", limits: LIMITS, replay: fork.replay });
		expect(engine.calls).toBe(asked + 1);
		expect(movesOf(forked.log)).toHaveLength(5);
		expect(movesOf(forked.log).slice(0, 3)).toEqual(movesOf(first.log).slice(0, 3));
	});
});

/** An engine whose reply in a position changes from one call to the next, as Stockfish's can. */
function restlessEngine(): Engine & { readonly calls: number } {
	let calls = 0;
	return {
		name: "Fake 2",
		get calls() {
			return calls;
		},
		move: (fen) => {
			calls += 1;
			const legal = new Chess(fen).moves({ verbose: true });
			return Promise.resolve(legal[calls % legal.length]?.lan ?? "(none)");
		},
	};
}

/** A model that plays the first legal move `moves` times, then resigns. */
const firstMoves = (moves: number) =>
	fakeDecider((request, call) => (call <= moves ? picking() : picking("stop"))(request, call));

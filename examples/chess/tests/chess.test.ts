import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { recordedModel, replayOf, run } from "@osolmaz/switch";
import { failing, fakeDecider } from "@osolmaz/switch/testing";
import {
	caseSchema,
	CHESS,
	type ChessGame,
	chessMachine,
	type ChessState,
	type Engine,
	EngineError,
	LIMITS,
	outcomeOf,
	STANDARD_START,
} from "../src/index.ts";
import { boardOf, gameAfter, materialOf, opponentMove, statusOf, unitOf } from "../src/game.ts";
import { describe as describeMove, movesIn } from "../src/move.ts";
import { chessView, numbered } from "../src/view.ts";
import { game, picking, stateOf } from "./helpers/chess.ts";

const MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
const STALEMATE_IN_ONE = "k7/8/2Q5/8/8/8/8/7K w - - 0 1";

/** An engine that plays the first legal move, named Fake 1. */
const FIRST_MOVE: Engine = {
	name: "Fake 1",
	move: (fen) => Promise.resolve(new Chess(fen).moves({ verbose: true })[0]?.lan ?? "(none)"),
};

const initialOf = (match: ChessGame): Promise<ChessState> => chessMachine(match).initial();

/** The state after the model played the choice with `key` in `state`. */
async function played(match: ChessGame, state: ChessState, key: string): Promise<ChessState> {
	const choice = movesIn(state).find((offered) => offered.key === key);
	if (choice === undefined) throw new Error(`no choice ${key}`);
	return chessMachine(match).transition(state, choice);
}

const playGame = (match: ChessGame, policy = picking(), steps = LIMITS.steps) =>
	run({ ...CHESS, limits: { ...LIMITS, steps } }, chessMachine(match), fakeDecider(policy));

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
		expect(statusOf(gameAfter(STANDARD_START, ["f2f3", "e7e5", "g2g4", "d8h4"]))).toBe("checkmate");
		expect(statusOf(new Chess("k7/8/1Q6/8/8/8/8/7K b - - 0 1"))).toBe("stalemate");
		expect(statusOf(new Chess("k7/8/8/8/8/8/8/7K w - - 0 1"))).toBe("insufficient material");
		expect(statusOf(new Chess("k7/8/8/8/8/8/R7/7K w - - 100 80"))).toBe("fifty-move rule");
		const repeated = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
		expect(statusOf(gameAfter(STANDARD_START, repeated))).toBe("threefold repetition");
	});

	it("counts material, and works out the board of a state from its start and its moves", () => {
		expect(materialOf(new Chess())).toEqual({ white: 39, black: 39 });
		const state = stateOf(["e2e4", "e7e5"]);
		expect(state).toMatchObject({ moves: ["e2e4", "e7e5"], san: ["e4", "e5"], status: "playing", check: false });
		expect(boardOf(state).fen()).toBe(state.fen);
		const repeated = stateOf(["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);
		expect(repeated.status).toBe("threefold repetition");
	});
});

describe("the choice function and the transition function", () => {
	it("offer every legal move with a unique key, words for the model and squares for the viewer", async () => {
		const choices = movesIn(await initialOf(game()));
		expect(choices).toHaveLength(20);
		expect(choices.find((choice) => choice.key === "move:0:e2e4")).toMatchObject({
			type: "move",
			text: "e4 (pawn e2 to e4)",
			lan: "e2e4",
			data: { from: "e2", to: "e4", san: "e4" },
		});
	});

	it("offer no move once the game is over", async () => {
		const over = game({ start: "k7/8/1Q6/8/8/8/8/7K b - - 0 1", side: "black" });
		expect(movesIn(await initialOf(over))).toEqual([]);
	});

	it("play the move and the opponent's reply, and record both", async () => {
		const match = game();
		const state = await played(match, await initialOf(match), "move:0:e2e4");
		const reply = opponentMove(gameAfter(match.start, ["e2e4"]), match.seed, ["e2e4"]);
		expect(state.last).toBe(`You played e4. The opponent played ${reply?.san ?? "?"}.`);
		expect(state).toMatchObject({ you: "white", moves: ["e2e4", reply?.lan], status: "playing" });
		expect(movesIn(state)[0]?.key).toMatch(/^move:2:/);
	});

	it("play no reply after a move that ends the game", async () => {
		const match = game({ start: MATE_IN_ONE });
		const initial = await initialOf(match);
		const mate = movesIn(initial).find((choice) => choice.text.includes("checkmate"));
		const state = await played(match, initial, mate?.key ?? "");
		expect(state.last).toBe("You played Rd8#. Checkmate: the game is over.");
		expect(state).toMatchObject({ moves: ["d1d8"], status: "checkmate", check: true });
	});

	it("say in words what a move does", () => {
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

	it("shows the board, both sides' pieces, the moves so far and what the last step did", () => {
		const view = chessView({ ...stateOf(["e2e4", "e7e5"]), last: "You played e4." }, 10_000, 3);
		expect(view.decisionState).toMatchObject({
			you: "white",
			to_move: "white",
			in_check: false,
			moves: "1. e4 e5",
			last_step: "You played e4.",
		});
		expect(view.decisionState["board"]).toContain("4 . . . . P . . .");
		expect(view.decisionState["your_pieces"]).toContain("Ke1");
		expect(view.decisionState["opponent_pieces"]).toContain("Pe5");
		expect(view.decisionImages).toBeUndefined();
	});

	it("keeps only the latest moves when the whole game does not fit", () => {
		const board = new Chess();
		const moves: string[] = [];
		for (let ply = 0; ply < 40; ply += 1) {
			const legal = board.moves({ verbose: true })[0];
			if (legal === undefined) break;
			moves.push(board.move(legal.lan).lan);
		}
		const view = chessView(stateOf(moves), 50, 3);
		expect(view.decisionState["moves"]).toEqual(expect.stringMatching(/^… /));
		// The first moves are cut: the game's first move number is gone.
		expect(view.decisionState["moves"]).not.toMatch(/(^|\s)1\. /);
	});
});

describe("a game", () => {
	it("ends in a win when the model gives checkmate", async () => {
		const result = await playGame(game({ start: MATE_IN_ONE }), picking(/checkmate/));
		expect(result.steps).toBe(1);
		expect(result.answers).toEqual({});
		expect(outcomeOf(result)).toMatchObject({ result: "win", reason: "checkmate", moves: 1 });
	});

	it("ends in a draw at stalemate, in a loss on resignation, and unfinished at the step limit or a failed pick", async () => {
		const drawn = await playGame(game({ start: STALEMATE_IN_ONE }), picking(/^Qb6/));
		expect(outcomeOf(drawn)).toMatchObject({ result: "draw", reason: "stalemate" });
		const resigned = await playGame(game(), picking("stop"));
		expect(outcomeOf(resigned)).toMatchObject({
			result: "loss",
			reason: "resignation",
			moves: 0,
		});
		const short = await playGame(game(), picking(), 2);
		expect(outcomeOf(short)).toMatchObject({
			result: "unfinished",
			reason: "step limit",
			moves: 4,
		});
		const lost = await run(
			CHESS,
			chessMachine(game()),
			fakeDecider(() => failing("down")),
		);
		expect(outcomeOf(lost)).toMatchObject({ result: "unfinished", reason: "pick failed" });
	});

	it("counts a checkmate against the model as a loss", () => {
		const state = stateOf(["f2f3", "e7e5", "g2g4", "d8h4"]);
		expect(outcomeOf({ state, ended: "no choices" })).toMatchObject({ result: "loss", reason: "checkmate" });
	});

	it("lets the model play both sides in self-play, one move a step, from the side to move", async () => {
		const match = game({ opponent: "self" });
		const initial = await initialOf(match);
		expect(initial).toMatchObject({
			last: "The game starts. You play both sides.",
			you: "both",
			opponent: "itself",
			moves: [],
		});
		const first = await played(match, initial, "move:0:e2e4");
		expect(first).toMatchObject({ last: "White played e4.", you: "both", moves: ["e2e4"] });
		expect(chessView(first, 10_000, 3).decisionState).toMatchObject({ you: "black", to_move: "black" });
		expect(movesIn(first).map((choice) => choice.key)).toContain("move:1:e7e5");
	});

	it("names the winner in self-play: checkmate, resignation, a draw or the step limit", async () => {
		const won = await playGame(game({ opponent: "self", start: MATE_IN_ONE }), picking(/checkmate/));
		expect(outcomeOf(won)).toMatchObject({ result: "white wins", reason: "checkmate", moves: 1 });
		const open = game({ opponent: "self" });
		const resigned = await playGame(open, picking("stop"));
		expect(outcomeOf(resigned)).toMatchObject({ result: "black wins", reason: "resignation" });
		const drawn = await playGame(game({ opponent: "self", start: STALEMATE_IN_ONE }), picking(/^Qb6/));
		expect(outcomeOf(drawn)).toMatchObject({ result: "draw", reason: "stalemate" });
		const short = await playGame(open, picking(), 3);
		expect(outcomeOf(short)).toMatchObject({
			result: "unfinished",
			reason: "step limit",
			moves: 3,
		});
	});

	it("lets the opponent move first when the model plays black", async () => {
		const match = game({ side: "black" });
		const initial = await initialOf(match);
		expect(initial.last).toMatch(/^The game starts\. You play black\. The opponent played \S+\.$/);
		expect(initial).toMatchObject({
			you: "black",
			status: "playing",
			opponent: "random legal moves, seed 7",
			start: STANDARD_START,
		});
		expect(initial.moves).toHaveLength(1);
		expect(movesIn(initial)).toHaveLength(20);
	});
});

describe("a game against an engine", () => {
	it("plays the engine's reply, and names the engine and its time a move", async () => {
		const match = { ...game({ opponent: "stockfish", movetime: 500 }), engine: FIRST_MOVE };
		const initial = await initialOf(match);
		expect(initial).toMatchObject({
			last: "The game starts. You play white.",
			you: "white",
			opponent: "Fake 1, 0.5 s a move",
			moves: [],
		});
		const reply = await FIRST_MOVE.move(gameAfter(match.start, ["e2e4"]).fen());
		const board = new Chess();
		board.move("e2e4");
		const san = board.move(reply).san;
		expect(await played(match, initial, "move:0:e2e4")).toMatchObject({
			last: `You played e4. The opponent played ${san}.`,
			you: "white",
			moves: ["e2e4", reply],
		});
	});

	it("lets the engine move first when the model plays black, and needs an engine", async () => {
		const black = game({ opponent: "stockfish", side: "black" });
		const initial = await initialOf({ ...black, engine: FIRST_MOVE });
		expect(initial.last).toMatch(/^The game starts\. You play black\. The opponent played \S+\.$/);
		expect(initial).toMatchObject({ opponent: "Fake 1, 1 s a move", moves: ["a2a3"] });
		await expect(initialOf(black)).rejects.toThrow(EngineError);
	});

	it("counts the result for the model, as against the random opponent", async () => {
		const match = { ...game({ opponent: "stockfish", start: MATE_IN_ONE }), engine: FIRST_MOVE };
		const won = await playGame(match, picking(/checkmate/));
		expect(outcomeOf(won)).toMatchObject({ result: "win", reason: "checkmate" });
	});

	it("replays the recorded game although the engine's replies change, and asks the engine only after a fork", async () => {
		const engine = restlessEngine();
		const match = { ...game({ opponent: "stockfish", side: "black" }), engine };
		const first = await run(CHESS, chessMachine(match), firstMoves(3));
		const asked = engine.calls;
		expect(asked).toBe(4);

		const entries = first.trace.entries;
		const again = await run(CHESS, chessMachine(match), recordedModel(entries), { replay: replayOf(entries) });
		expect(engine.calls).toBe(asked);
		expect(again.state.moves).toEqual(first.state.moves);
		expect(again.ended).toBe("stop");

		const fork = replayOf(entries, { fork: 1 });
		const forked = await run(CHESS, chessMachine(match), firstMoves(1), { replay: fork });
		expect(engine.calls).toBe(asked + 1);
		expect(forked.state.moves).toHaveLength(5);
		expect(forked.state.moves.slice(0, 3)).toEqual(first.state.moves.slice(0, 3));
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

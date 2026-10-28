// @vitest-environment happy-dom
import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { arrowPoints, createBoard, type Position } from "../src/web/board.ts";
import { piecesOf } from "../src/web/model.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const at = (fen: string, fields: Partial<Position> = {}): Position => ({
	fen,
	flipped: false,
	last: [],
	check: null,
	arrows: [],
	...fields,
});
const place = (fen: string) =>
	piecesOf(fen)
		.map((piece) => `${piece.color}${piece.kind}@${piece.square}`)
		.sort();

/** Where the board shows its pieces, read back from their places on the grid. */
function shown(element: HTMLElement, flipped = false): string[] {
	return Array.from(element.querySelectorAll<HTMLElement>(".piece:not(.taken)"))
		.map((node) => {
			const x = Number(node.style.getPropertyValue("--x"));
			const y = Number(node.style.getPropertyValue("--y"));
			const square = flipped
				? `${"abcdefgh".charAt(7 - x)}${String(y + 1)}`
				: `${"abcdefgh".charAt(x)}${String(8 - y)}`;
			return `${node.dataset["piece"] ?? "?"}@${square}`;
		})
		.sort();
}

describe("the board", () => {
	it("shows a position with its coordinates, from either side", () => {
		const board = createBoard(document, { wK: "data:king" });
		board.show(at(START));
		expect(shown(board.element)).toEqual(place(START));
		const cells = Array.from(board.element.querySelectorAll(".square"));
		expect(cells[0]?.textContent).toBe("8");
		expect(cells[63]?.textContent).toBe("h");
		expect(board.element.querySelector<HTMLElement>('[data-piece="wk"]')?.style.backgroundImage).toContain(
			"data:king",
		);
		board.show(at(START, { flipped: true }));
		expect(shown(board.element, true)).toEqual(place(START));
		expect(cells[0]?.textContent).toBe("1");
		expect(cells[63]?.textContent).toBe("a");
	});

	it("marks the last move and a king in check, and draws an arrow per choice with its label", () => {
		const board = createBoard(document, {});
		const arrows = [
			{ from: "e2", to: "e4", probability: 0.7, picked: true, label: "e4 70.0%" },
			{ from: "d2", to: "d4", probability: 0.2, picked: false, label: "d4 20.0%" },
		];
		board.show(at(START, { last: ["e7", "e5"], check: "e1", arrows }));
		expect(board.element.querySelectorAll(".mark.last")).toHaveLength(2);
		expect(board.element.querySelectorAll(".mark.check")).toHaveLength(1);
		expect(Array.from(board.element.querySelectorAll("polygon")).map((shape) => shape.getAttribute("class"))).toEqual(
			["arrow picked", "arrow"],
		);
		expect(board.element.querySelector("polygon title")?.textContent).toBe("e4 70.0%");
		expect(board.element.getAttribute("aria-label")).toBe("Chess board; the model picked e4 70.0%");
	});

	it("draws an arrow wider for a likelier move, ending on its target square", () => {
		const wide = arrowPoints({ from: "e2", to: "e4", probability: 1, picked: true, label: "" }, false).split(" ");
		const thin = arrowPoints({ from: "e2", to: "e4", probability: 0, picked: false, label: "" }, false).split(" ");
		const width = (points: string[]) => Math.abs(Number(points[0]?.split(",")[0]) - Number(points[6]?.split(",")[0]));
		expect(width(wide)).toBeGreaterThan(width(thin));
		expect(wide[3]).toBe("4.500,4.500");
		expect(arrowPoints({ from: "e2", to: "e4", probability: 0, picked: false, label: "" }, true).split(" ")[3]).toBe(
			"3.500,3.500",
		);
	});

	it("plays castling, en passant and promotion, and ends where the game is", async () => {
		const board = createBoard(document, {});
		const game = new Chess("r3k2r/8/8/8/8/8/1p6/R3K2R w KQkq - 0 1");
		board.show(at(game.fen()));
		const moves = ["e1g1", "b2a1q"].map((move) => game.move(move).lan);
		await board.animate(moves, at(game.fen()), 0);
		expect(shown(board.element)).toEqual(place(game.fen()));
		const passant = new Chess("k7/8/8/3pP3/8/8/8/K7 w - d6 0 1");
		board.show(at(passant.fen()));
		await board.animate([passant.move("e5d6").lan], at(passant.fen()), 0);
		expect(shown(board.element)).toEqual(place(passant.fen()));
	});

	it("shows the position at once when the moves do not lead to it, or the side changes", async () => {
		const board = createBoard(document, {});
		board.show(at(START));
		await board.animate(["e2e4"], at("k7/8/8/8/8/8/8/K7 w - - 0 1"), 0);
		expect(shown(board.element)).toEqual(place("k7/8/8/8/8/8/8/K7 w - - 0 1"));
		await board.animate(["a1a2"], at(START, { flipped: true }), 0);
		expect(shown(board.element, true)).toEqual(place(START));
	});

	it("keeps the pieces where the game has them through a whole game", async () => {
		const board = createBoard(document, {});
		const game = new Chess();
		board.show(at(game.fen()));
		for (let ply = 0; ply < 200 && !game.isGameOver(); ply += 2) {
			const moves: string[] = [];
			for (let half = 0; half < 2 && !game.isGameOver(); half += 1) {
				const legal = game.moves({ verbose: true });
				const pick = legal.find((move) => move.captured !== undefined) ?? legal[(ply * 7 + half) % legal.length];
				if (pick === undefined) break;
				moves.push(game.move(pick.lan).lan);
			}
			await board.animate(moves, at(game.fen()), 0);
			expect(shown(board.element), `after ${moves.join(" ")}`).toEqual(place(game.fen()));
		}
	});

	it("waits the gap before each move after the first, and marks each move as it lands", async () => {
		vi.useFakeTimers();
		try {
			const board = createBoard(document, {});
			board.show(at(START));
			const landed: number[] = [];
			const marked = () =>
				Array.from(board.element.querySelectorAll<HTMLElement>(".mark.last")).map(
					(node) => `${node.style.getPropertyValue("--x")},${node.style.getPropertyValue("--y")}`,
				);
			const after = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
			const glide = { gap: 500, landed: (move: number) => landed.push(move) };
			const done = board.animate(["e2e4", "e7e5"], at(after, { last: ["e7", "e5"] }), 100, glide);
			await vi.advanceTimersByTimeAsync(100);
			expect([landed, marked()]).toEqual([[0], ["4,6", "4,4"]]);
			await vi.advanceTimersByTimeAsync(499);
			expect(landed).toEqual([0]);
			await vi.advanceTimersByTimeAsync(101);
			await done;
			expect([landed, marked()]).toEqual([
				[0, 1],
				["4,1", "4,3"],
			]);
		} finally {
			vi.useRealTimers();
		}
	});
});

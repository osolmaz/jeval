import { describe, expect, it } from "vitest";
import { boardPicture } from "../../../src/domains/chess/index.ts";
import { logOf } from "../../helpers/chess.ts";

const positionAfter = (side: "white" | "black", moves: string[]) => logOf(side, moves)[0]?.observation.data;
const option = (from: string, to: string, san: string, probability: number, chosen = false) => ({
	data: { from, to, san },
	probability,
	chosen,
});

describe("the board picture", () => {
	it("is empty when the position cannot be read", () => {
		expect(boardPicture({ position: { fen: 3 }, options: [] })).toBe("");
		expect(boardPicture({ position: undefined, options: [] })).toBe("");
	});

	it("draws every square, the pieces and the last move", () => {
		const svg = boardPicture({ position: positionAfter("white", ["e2e4"]), options: [] });
		expect(svg.match(/<rect /g)).toHaveLength(64 + 2);
		expect(svg.match(/<text [^>]*paint-order/g)).toHaveLength(32);
		expect(svg).not.toContain("<polygon");
	});

	it("draws arrows for the five likeliest moves and the chosen one, with each move's probability", () => {
		const options = [
			option("a2", "a3", "a3", 0.3),
			option("b2", "b3", "b3", 0.25),
			option("c2", "c3", "c3", 0.2),
			option("d2", "d3", "d3", 0.1),
			option("e2", "e3", "e3", 0.08),
			option("f2", "f3", "f3", 0.05),
			option("g2", "g3", "g3", 0.02, true),
			{ data: { from: "z9", to: "a1", san: "bad" }, probability: 0.9, chosen: false },
			{ data: null, probability: null, chosen: false },
		];
		const svg = boardPicture({ position: positionAfter("white", []), options });
		expect(svg.match(/<polygon/g)).toHaveLength(6);
		expect(svg).toContain("<title>a3: 30.0%</title>");
		expect(svg).toContain("<title>g3: 2.0%</title>");
		expect(svg).not.toContain("f3: 5.0%");
	});

	it("puts the model's side at the bottom", () => {
		const fileX = (svg: string, file: string) =>
			Number(new RegExp(`<text x="([\\d.]+)"[^>]*>${file}</text>`).exec(svg)?.[1]);
		const white = boardPicture({ position: positionAfter("white", []), options: [] });
		const black = boardPicture({ position: positionAfter("black", []), options: [] });
		expect(fileX(white, "a")).toBeLessThan(fileX(white, "h"));
		expect(fileX(black, "a")).toBeGreaterThan(fileX(black, "h"));
	});
});

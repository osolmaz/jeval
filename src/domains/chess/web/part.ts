/// <reference lib="dom" />
/** The chess part of the page: the board with its moves and sounds, the players' bars, the move list and the PGN. */
import type { Moment, Session } from "../../../view/web/model.ts";
import { type DomainPart, type PartContext, registerPart } from "../../../view/web/part.ts";
import { type BoardView, createBoard } from "./board.ts";
import { chessStep } from "./data.ts";
import { pgnOf, scoreOf } from "./model.ts";
import { moveList, playerRow, positionOf, turnOf } from "./panels.ts";
import { endingOf, type SoundSet, soundOf, Sounds } from "./sound.ts";

/** Seconds between the last move's sound and the end's. */
const ENDING_DELAY = 0.25;

/** What the server gives the chess part: the piece images by name, such as wK, and the sound clips. */
interface ChessConfig {
	readonly pieces: Readonly<Record<string, string>>;
	readonly sounds?: SoundSet;
}

function chessConfig(config: Readonly<Record<string, unknown>>): ChessConfig {
	const { pieces, sounds } = config;
	const images = typeof pieces === "object" && pieces !== null ? (pieces as Readonly<Record<string, string>>) : {};
	return typeof sounds === "object" && sounds !== null
		? { pieces: images, sounds: sounds as SoundSet }
		: { pieces: images };
}

/** The model's and the opponent's names. */
function namesOf(session: Session): { model: string; opponent: string } {
	const { model } = session.story;
	const opponent = chessStep(session.story.opening.at(-1)?.data)?.opponent;
	if (opponent === "itself") return { model, opponent: model };
	return { model, opponent: opponent ?? "opponent" };
}

/** The moves that lead from a step's decision to the next moment: the model's move and the reply. */
function movesAfter(moment: Moment): { readonly uci: readonly string[]; readonly san: readonly string[] } {
	const step = chessStep(moment.frame?.after?.data);
	return { uci: step?.moves ?? [], san: step?.san ?? [] };
}

/** The chess part for one page: it keeps one board, which moves from position to position. */
export function chessPart(context: PartContext): DomainPart {
	const { pieces, sounds: clips } = chessConfig(context.config);
	const sounds = new Sounds(clips);
	let board: BoardView | null = null;
	const glide = async (shown: BoardView, from: Moment, moment: Moment): Promise<void> => {
		const position = positionOf(moment);
		if (position === null) return;
		const moves = movesAfter(from);
		const landed = (move: number) => {
			const san = moves.san[move];
			if (san !== undefined) sounds.play(soundOf(san));
		};
		await shown.animate(moves.uci, position, context.motion(), { gap: context.gap(), landed });
	};
	return {
		async stage(moment, from) {
			const position = positionOf(moment);
			if (position === null) {
				board = null;
				return null;
			}
			if (board === null || from === null) {
				board ??= createBoard(document, pieces);
				board.show(position);
			} else await glide(board, from, moment);
			return board.element;
		},
		bars(moment, session) {
			const step = chessStep(moment.seen?.data);
			if (step === null) return { top: null, bottom: null };
			const { model, opponent } = namesOf(session);
			// The model's side is at the bottom; in self-play it plays both, with white at the bottom.
			const mine = step.you === "black" ? "b" : "w";
			const theirs = mine === "w" ? "b" : "w";
			return {
				top: playerRow(opponent, theirs, step.fen, pieces),
				bottom: playerRow(model, mine, step.fen, pieces),
			};
		},
		stepNote: turnOf,
		steps: { title: "Moves", list: (session, index, open) => moveList(session.story, index, pieces, open) },
		score: scoreOf,
		hidden: ["fen"],
		download: {
			label: "Download the game as PGN",
			text: "PGN",
			file: (session) => ({
				name: `${session.story.case}.pgn`,
				type: "application/x-chess-pgn",
				text: pgnOf(session),
			}),
		},
		sound: {
			get enabled() {
				return sounds.enabled;
			},
			toggle: () => {
				sounds.toggle();
			},
			wake: () => {
				sounds.wake();
			},
			started: () => {
				sounds.play("game-start");
			},
			ended: (session) => {
				sounds.play(endingOf(session.outcome?.["reason"]), ENDING_DELAY);
			},
		},
	};
}

registerPart("chess", chessPart);

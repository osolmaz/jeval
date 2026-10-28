/// <reference lib="dom" />
/**
 * The chess part of the page: the board with its moves and sounds between the players' bars, the sound button, the
 * move list with the score, and the PGN.
 */
import {
	type DomainPart,
	h,
	type Moment,
	type PartContext,
	registerPart,
	type Session,
} from "@osolmaz/switch-viewer/page";
import { type BoardView, createBoard } from "./board.ts";
import { chessState, movesOfStep } from "./data.ts";
import { initialOf, pgnOf } from "./model.ts";
import { moveList, playerRow, positionOf, soundButton, turnOf } from "./panels.ts";
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
	const opponent = initialOf(session.story)?.opponent;
	if (opponent === "itself") return { model, opponent: model };
	return { model, opponent: opponent ?? "opponent" };
}

/** The moves that lead from a step's pick to the next moment: the model's move and the reply. */
function movesAfter(moment: Moment): { readonly uci: readonly string[]; readonly san: readonly string[] } {
	const { lan, san } = movesOfStep(chessState(moment.frame?.before), chessState(moment.frame?.after));
	return { uci: lan, san };
}

/**
 * The players' bars above and below the board, with the sound button in the top one. The model's side is at the
 * bottom; in self-play it plays both, with white at the bottom.
 */
function bars(moment: Moment, session: Session, pieces: ChessConfig["pieces"], sound: HTMLElement): HTMLElement[] {
	const state = chessState(moment.state);
	if (state === null) return [];
	const { model, opponent } = namesOf(session);
	const mine = state.you === "black" ? "b" : "w";
	const theirs = mine === "w" ? "b" : "w";
	const top = playerRow(opponent, theirs, state.fen, pieces);
	top.append(sound);
	return [top, playerRow(model, mine, state.fen, pieces)];
}

/** The chess part for one page: it keeps one board, which moves from position to position. */
export function chessPart(context: PartContext): DomainPart {
	const { pieces, sounds: clips } = chessConfig(context.config);
	const sounds = new Sounds(clips);
	const sound = soundButton(sounds);
	const slots = [h("div", { class: "player-slot" }), h("div", {}), h("div", { class: "player-slot" })] as const;
	const area = h("div", { class: "chess-board-area" }, ...slots);
	// A browser lets a page play sound only after a click or a key press, so any of them on the page wakes the sounds.
	for (const type of ["pointerdown", "keydown"]) {
		document.addEventListener(type, () => {
			if (area.isConnected) sounds.wake();
		});
	}
	let board: BoardView | null = null;
	/** The board, which the part makes and puts between the bars the first time. */
	const boardOn = (): BoardView => {
		if (board === null) {
			board = createBoard(document, pieces);
			slots[1].replaceChildren(board.element);
		}
		return board;
	};
	const showBars = (moment: Moment, session: Session): void => {
		const rows = bars(moment, session, pieces, sound);
		slots[0].replaceChildren(...rows.slice(0, 1));
		slots[2].replaceChildren(...rows.slice(1));
	};
	const glide = async (shown: BoardView, from: Moment, moment: Moment): Promise<void> => {
		const position = positionOf(moment);
		if (position === null) return;
		if (from.type === "start") sounds.play("game-start");
		const moves = movesAfter(from);
		const landed = (move: number) => {
			const san = moves.san[move];
			if (san !== undefined) sounds.play(soundOf(san));
		};
		await shown.animate(moves.uci, position, context.motion(), { gap: context.gap(), landed });
	};
	return {
		async draw(moment, from, session) {
			const position = positionOf(moment);
			if (position === null) {
				board = null;
				return null;
			}
			showBars(moment, session);
			if (board === null || from === null) boardOn().show(position);
			else {
				await glide(board, from, moment);
				if (moment.type === "end") sounds.play(endingOf(session.outcome?.["reason"]), ENDING_DELAY);
			}
			return area;
		},
		stepNote: turnOf,
		steps: { title: "Moves", list: (session, index, open) => moveList(session, index, pieces, open) },
		hidden: ["result", "reason", "fen"],
		download: {
			label: "Download the game as PGN",
			text: "PGN",
			file: (session) => ({
				name: `${session.story.case}.pgn`,
				type: "application/x-chess-pgn",
				text: pgnOf(session),
			}),
		},
	};
}

registerPart("chess", chessPart);

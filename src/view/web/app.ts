/// <reference lib="dom" />
import { type BoardView, createBoard, type Glide } from "./board.ts";
import { chessStep, type Moment, momentsOf, pgnOf, type Session } from "./model.ts";
import {
	confidenceChart,
	decisionPanel,
	h,
	layout,
	moveList,
	type Parts,
	playerRow,
	positionOf,
	resultPanel,
} from "./panels.ts";
import { type SoundSet, soundOf, Sounds } from "./sound.ts";

/** How a page starts: with its session in it, or with the addresses to fetch it from while the case runs. */
export interface AppConfig {
	readonly session?: Session;
	readonly sessionUrl?: string;
	readonly versionUrl?: string;
	/** The page that lists the run's cases, which the header links to. */
	readonly indexUrl?: string;
	/** Piece images by name: wK, bQ and so on. */
	readonly pieces: Readonly<Record<string, string>>;
	/** The sound clips and the clips each event plays; a page without them is silent. */
	readonly sounds?: SoundSet;
	/** Milliseconds one move glides, a decision stays on screen while playing, and between checks for news, at speed 1. */
	readonly motion?: number;
	readonly dwell?: number;
	readonly poll?: number;
}

const pause = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});

const isSession = (value: unknown): value is Session =>
	typeof value === "object" && value !== null && "story" in value && "version" in value;

/** The viewer: one case's moments, shown one at a time, with playback and, while the case runs, its news. */
export class App {
	private readonly config: AppConfig;
	private readonly parts: Parts;
	private board: BoardView | null = null;
	private session: Session | null = null;
	private moments: Moment[] = [];
	private index = 0;
	/** Where the view is going: the last moment asked for, which the queue reaches one move at a time. */
	private goal = 0;
	/** Whether the view moves on by itself when the case does. */
	private following = false;
	private playing = false;
	private waiting = false;
	private queue: Promise<void> = Promise.resolve();
	private readonly timer: ReturnType<typeof setInterval> | undefined;
	private readonly sounds: Sounds;
	private readonly onKey = (event: KeyboardEvent): void => {
		this.sounds.wake();
		this.key(event);
	};
	private readonly onPointer = (): void => {
		this.sounds.wake();
	};

	constructor(root: HTMLElement, config: AppConfig) {
		this.config = config;
		this.sounds = new Sounds(config.sounds);
		this.parts = layout(root);
		this.controls();
		document.addEventListener("keydown", this.onKey);
		document.addEventListener("pointerdown", this.onPointer);
		if (config.session !== undefined) this.load(config.session);
		else void this.fetchSession();
		const poll =
			config.versionUrl === undefined ? undefined : setInterval(() => void this.check(), config.poll ?? 1000);
		this.timer = poll;
	}

	/** Stops asking for news and listening to the keyboard. */
	close(): void {
		clearInterval(this.timer);
		document.removeEventListener("keydown", this.onKey);
		document.removeEventListener("pointerdown", this.onPointer);
		this.playing = false;
	}

	get at(): number {
		return this.index;
	}

	get speed(): number {
		return Number(this.parts.speed.value) || 1;
	}

	private get motion(): number {
		const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
		return reduced ? 0 : (this.config.motion ?? 320) / this.speed;
	}

	/** How long a move stays on the board before the next one while the game plays. */
	private get dwell(): number {
		return (this.config.dwell ?? 1100) / this.speed;
	}

	private get last(): number {
		return this.moments.length - 1;
	}

	/** Takes a new session: the first one opens the case, later ones move on to the news when the view follows. */
	load(session: Session): void {
		const first = this.session === null;
		this.session = session;
		this.waiting = false;
		this.moments = momentsOf(session.story, session.finished);
		this.header(session);
		if (first) {
			this.following = !session.finished && this.config.versionUrl !== undefined;
			void this.go(this.following ? this.last : 0, false);
			return;
		}
		if (!this.following) this.panels();
		else if (this.last > this.goal) this.walk(this.last);
		// The newest step can change in place: its choice arrives after its menu.
		else void this.go(this.last, false);
	}

	/** Shows moment `target`, gliding the pieces when it is the next one. */
	go(target: number, animate: boolean): Promise<void> {
		const next = Math.max(0, Math.min(this.last, target));
		this.goal = next;
		this.queue = this.queue.then(() => this.move(next, animate));
		return this.queue;
	}

	private async move(target: number, animate: boolean): Promise<void> {
		// Moments passed on the way to a later goal are drawn at once, so the board keeps up with the clicks.
		const glide = animate && target === this.index + 1 && target === this.goal;
		const moves = glide ? movesAfter(this.moments[this.index]) : null;
		this.index = target;
		await this.draw(moves);
		if (glide && this.board !== null && this.moments[target]?.kind === "end") this.sounds.play("end");
	}

	/** Steps to `target` one moment at a time, each with its animation. */
	private walk(target: number): void {
		for (let next = this.goal + 1; next <= target; next += 1) void this.go(next, true);
	}

	private header(session: Session): void {
		const { story } = session;
		this.parts.title.textContent = story.case;
		this.parts.meta.textContent = `${story.domain} · ${story.model}`;
		this.parts.live.hidden = session.finished || this.config.versionUrl === undefined;
		this.parts.pgn.hidden = chessStep(story.opening.at(-1)?.data) === null;
		this.parts.sound.hidden = this.parts.pgn.hidden;
		if (this.config.indexUrl !== undefined) {
			this.parts.home.setAttribute("href", this.config.indexUrl);
			this.parts.home.title = "All cases of the run";
		}
	}

	private async draw(moves: Played | null): Promise<void> {
		const moment = this.moments[this.index];
		if (moment === undefined) return;
		const position = positionOf(moment);
		this.panels();
		if (position === null) {
			this.board = null;
			const text = moment.seen?.text ?? "";
			this.parts.stage.replaceChildren(h("div", { class: "found-card" }, text === "" ? "Nothing seen yet." : text));
			this.parts.top.replaceChildren();
			this.parts.bottom.replaceChildren();
			return;
		}
		this.players(moment, position.fen);
		if (this.board === null) {
			this.board = createBoard(document, this.config.pieces);
			this.parts.stage.replaceChildren(this.board.element);
			this.board.show(position);
		} else if (moves === null) this.board.show(position);
		else await this.board.animate(moves.uci, position, this.motion, this.glide(moves));
	}

	/** While the game plays, the reply waits as long after the model's move as the next move waits after it. */
	private glide(moves: Played): Glide {
		return {
			gap: this.playing ? this.dwell : 0,
			landed: (move) => {
				const san = moves.san[move];
				if (san !== undefined) this.sounds.play(soundOf(san));
			},
		};
	}

	private players(moment: Moment, fen: string): void {
		const step = chessStep(moment.seen?.data);
		if (step === null) return;
		const { model, opponent } = namesOf(this.session);
		// The model's side is at the bottom; in self-play it plays both, with white at the bottom.
		const mine = step.you === "black" ? "b" : "w";
		const theirs = mine === "w" ? "b" : "w";
		this.parts.top.replaceChildren(playerRow(opponent, theirs, fen, this.config.pieces));
		this.parts.bottom.replaceChildren(playerRow(model, mine, fen, this.config.pieces));
	}

	private panels(): void {
		const moment = this.moments[this.index];
		const session = this.session;
		this.parts.result.replaceChildren(resultPanel(session, this.waiting));
		if (moment === undefined || session === null) return;
		this.parts.chart.replaceChildren(...confidenceChart(session, this.index));
		this.parts.chart.hidden = this.parts.chart.childElementCount === 0;
		this.parts.side.replaceChildren(decisionPanel(moment));
		this.parts.moves.replaceChildren(
			...moveList(session.story, this.index, this.config.pieces, (target) => {
				this.stop();
				this.following = false;
				void this.go(target, false);
			}),
		);
		this.reveal();
		this.parts.scrub.max = String(this.last);
		this.parts.scrub.value = String(this.index);
		this.parts.where.textContent = moment.label;
		this.parts.play.textContent = this.playing ? "Pause" : "Play";
		this.parts.play.setAttribute("aria-label", this.playing ? "Pause" : "Play");
	}

	/** Scrolls the move list so that the latest move on the board is in view. */
	private reveal(): void {
		const list = this.parts.moves.querySelector<HTMLElement>(".plies");
		const current = list?.querySelector<HTMLElement>(".current") ?? null;
		if (list === null || current === null) return;
		list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - list.clientHeight / 2);
	}

	private controls(): void {
		const { parts } = this;
		const jump = (name: string, label: string, text: string, target: () => number, animate = false) => {
			const node = h("button", { type: "button", class: name, "aria-label": label, title: label }, text);
			node.addEventListener("click", () => {
				this.stop();
				this.following = this.isLive() && target() >= this.last;
				void this.go(target(), animate);
			});
			return node;
		};
		parts.play.addEventListener("click", () => {
			this.toggle();
		});
		parts.scrub.addEventListener("input", () => {
			const target = Number(parts.scrub.value);
			this.stop();
			this.following = this.isLive() && target >= this.last;
			void this.go(target, false);
		});
		parts.pgn.addEventListener("click", () => {
			this.downloadPgn();
		});
		parts.sound.addEventListener("click", () => {
			this.sounds.toggle();
			this.soundButton();
		});
		this.soundButton();
		const buttons = h(
			"div",
			{ class: "buttons" },
			jump("first", "First", "⏮", () => 0),
			jump("previous", "Previous", "◀", () => this.goal - 1),
			parts.play,
			jump("next", "Next", "▶", () => this.goal + 1, true),
			jump("latest", "Latest", "⏭", () => this.last),
		);
		const status = h(
			"div",
			{ class: "status" },
			parts.where,
			h("span", { class: "spacer" }),
			h("label", { class: "speed" }, "Speed ", parts.speed),
		);
		parts.controls.replaceChildren(parts.scrub, buttons, status);
	}

	private soundButton(): void {
		const on = this.sounds.enabled;
		const { sound } = this.parts;
		sound.textContent = on ? "Sound on" : "Sound off";
		sound.setAttribute("aria-label", on ? "Turn the sound off" : "Turn the sound on");
		sound.title = sound.getAttribute("aria-label") ?? "";
		sound.setAttribute("aria-pressed", String(on));
	}

	/** Read through a method, since a click can stop the playing while the loop waits. */
	private isPlaying(): boolean {
		return this.playing;
	}

	private isLive(): boolean {
		return this.session !== null && !this.session.finished && this.config.versionUrl !== undefined;
	}

	private key(event: KeyboardEvent): void {
		const target = event.target;
		if (ignored(event)) return;
		const actions: Readonly<Record<string, () => void>> = {
			ArrowLeft: () => void this.go(this.goal - 1, false),
			ArrowRight: () => void this.go(this.goal + 1, true),
			Home: () => void this.go(0, false),
			End: () => void this.go(this.last, false),
		};
		const action = actions[event.key];
		if (action !== undefined) {
			this.stop();
			action();
		} else if (event.key === " " && !(target instanceof HTMLButtonElement)) {
			event.preventDefault();
			this.toggle();
		}
	}

	toggle(): void {
		if (this.playing) {
			this.stop();
			return;
		}
		this.playing = true;
		this.following = false;
		if (this.goal >= this.last) void this.go(0, false);
		void this.play();
	}

	private stop(): void {
		this.playing = false;
		this.panels();
	}

	private async play(): Promise<void> {
		this.panels();
		while (this.isPlaying() && this.index < this.last) {
			await pause(this.dwell);
			if (!this.isPlaying()) break;
			await this.go(this.goal + 1, true);
		}
		this.playing = false;
		this.following = this.isLive();
		this.panels();
	}

	private async fetchSession(): Promise<void> {
		const url = this.config.sessionUrl;
		if (url === undefined) return;
		const response = await fetch(url, { cache: "no-store" }).catch(() => null);
		const body: unknown = response?.ok === true ? await response.json() : null;
		if (isSession(body)) {
			this.load(body);
			return;
		}
		this.waiting = true;
		this.panels();
	}

	/** Asks whether the case changed, and fetches it when it did. */
	private async check(): Promise<void> {
		const url = this.config.versionUrl;
		if (url === undefined || this.session?.finished === true) return;
		const response = await fetch(url, { cache: "no-store" }).catch(() => null);
		if (response?.ok !== true) return;
		if ((await response.text()) !== this.session?.version) await this.fetchSession();
	}

	private downloadPgn(): void {
		if (this.session === null) return;
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob([pgnOf(this.session)], { type: "application/x-chess-pgn" }));
		link.download = `${this.session.story.case}.pgn`;
		link.click();
		URL.revokeObjectURL(link.href);
	}
}

/** The model's and the opponent's names. */
function namesOf(session: Session | null): { model: string; opponent: string } {
	const model = session?.story.model ?? "model";
	const opponent = chessStep(session?.story.opening.at(-1)?.data)?.opponent;
	if (opponent === "itself") return { model, opponent: model };
	return { model, opponent: opponent ?? "opponent" };
}

/** Keys typed into a field, or held with a modifier, belong to the field or the browser. */
function ignored(event: KeyboardEvent): boolean {
	const target = event.target;
	if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return true;
	return event.altKey || event.ctrlKey || event.metaKey;
}

/** Moves as the board plays them and as the sounds name them. */
interface Played {
	readonly uci: readonly string[];
	readonly san: readonly string[];
}

/** The moves that lead from a step's decision to the next moment: the model's move and the reply. */
function movesAfter(moment: Moment | undefined): Played {
	const step = chessStep(moment?.frame?.after?.data);
	return { uci: step?.moves ?? [], san: step?.san ?? [] };
}

/** Starts the viewer in `root`. */
export function start(root: HTMLElement, config: AppConfig): App {
	return new App(root, config);
}

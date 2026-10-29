/// <reference lib="dom" />
import { type Moment, momentsOf, type Session } from "./model.ts";
import { decisionPanel, h, layout, type Parts, pickChart, resultPanel } from "./panels.ts";
import { type DomainPart, partOf } from "./part.ts";

/** How a page starts: with its session in it, or with the addresses to fetch it from while the case runs. */
export interface AppConfig {
	readonly session?: Session;
	readonly sessionUrl?: string;
	readonly versionUrl?: string;
	/** The page that lists the run's cases, which the header links to. */
	readonly indexUrl?: string;
	/** Each domain part's config by the domain's name, such as the images it draws with. */
	readonly parts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	/** Milliseconds one motion of the drawing takes, a step stays on screen while playing, and between checks for news, at speed 1. */
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
	/** The domain's part of the page, known once the first session names the domain. */
	private part: DomainPart = {};
	private session: Session | null = null;
	private moments: Moment[] = [];
	private index = 0;
	/** Where the page is going: the last moment asked for, which the queue reaches one moment at a time. */
	private goal = 0;
	/** Whether the page moves on by itself when the case does. */
	private following = false;
	private playing = false;
	private waiting = false;
	private queue: Promise<void> = Promise.resolve();
	private readonly timer: ReturnType<typeof setInterval> | undefined;
	private readonly onKey = (event: KeyboardEvent): void => {
		this.key(event);
	};

	constructor(root: HTMLElement, config: AppConfig) {
		this.config = config;
		this.parts = layout(root);
		this.controls();
		document.addEventListener("keydown", this.onKey);
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

	/** How long a step stays on screen before the next one while the case plays. */
	private get dwell(): number {
		return (this.config.dwell ?? 1100) / this.speed;
	}

	private get last(): number {
		return this.moments.length - 1;
	}

	/** Takes a new session: the first one opens the case, later ones move on to the news when the page follows. */
	load(session: Session): void {
		const first = this.session === null;
		this.session = session;
		this.waiting = false;
		this.moments = momentsOf(session.story, session.finished);
		if (first) this.meet(session.story.domain);
		this.header(session);
		if (first) {
			this.following = !session.finished && this.config.versionUrl !== undefined;
			void this.go(this.following ? this.last : 0, false);
			return;
		}
		if (!this.following) this.panels();
		else if (this.last > this.goal) this.walk(this.last);
		// The newest step can change in place: its answers arrive after its questions.
		else void this.go(this.last, false);
	}

	/** Takes the part of the case's domain, and shows the buttons that the part has. */
	private meet(domain: string): void {
		this.part = partOf(domain, {
			config: this.config.parts?.[domain] ?? {},
			motion: () => this.motion,
			gap: () => (this.playing ? this.dwell : 0),
		});
		const { download, steps } = this.part;
		this.parts.download.hidden = download === undefined;
		if (download !== undefined) {
			this.parts.download.textContent = download.text;
			this.parts.download.setAttribute("aria-label", download.label);
			this.parts.download.title = download.label;
		}
		if (steps !== undefined) this.parts.stepsTitle.textContent = steps.title;
	}

	/** Shows moment `target`, moving the drawing when it is the next one. */
	go(target: number, animate: boolean): Promise<void> {
		const next = Math.max(0, Math.min(this.last, target));
		this.goal = next;
		this.queue = this.queue.then(() => this.move(next, animate));
		return this.queue;
	}

	private async move(target: number, animate: boolean): Promise<void> {
		// Moments passed on the way to a later goal are drawn at once, so the drawing keeps up with the clicks.
		const glide = animate && target === this.index + 1 && target === this.goal;
		const from = glide ? (this.moments[this.index] ?? null) : null;
		this.index = target;
		await this.draw(from);
	}

	/** Steps to `target` one moment at a time, each with its animation. */
	private walk(target: number): void {
		for (let next = this.goal + 1; next <= target; next += 1) void this.go(next, true);
	}

	private header(session: Session): void {
		const { story } = session;
		// A domain's stylesheet can restyle the page for its own cases under this attribute.
		document.documentElement.dataset["domain"] = story.domain;
		this.parts.title.textContent = story.case;
		this.parts.meta.textContent = `${story.domain} · ${story.model}`;
		this.parts.live.hidden = session.finished || this.config.versionUrl === undefined;
		if (this.config.indexUrl !== undefined) {
			this.parts.home.setAttribute("href", this.config.indexUrl);
			this.parts.home.title = "All cases of the run";
		}
	}

	/** Draws the current moment: the part's drawing, moved there from `from`, or the state as JSON. */
	private async draw(from: Moment | null): Promise<void> {
		const moment = this.moments[this.index];
		const session = this.session;
		if (moment === undefined || session === null) return;
		this.panels();
		this.place(moment, (await this.part.draw?.(moment, from, session)) ?? null);
	}

	/** Puts the part's drawing on the page, or the state as JSON when there is none. */
	private place(moment: Moment, drawing: HTMLElement | null): void {
		if (drawing === null) {
			const text = moment.state === null ? "No state yet." : JSON.stringify(moment.state, null, 2);
			this.parts.drawing.replaceChildren(h("div", { class: "state-card" }, text));
		} else if (this.parts.drawing.firstElementChild !== drawing) {
			this.parts.drawing.replaceChildren(drawing);
		}
	}

	private panels(): void {
		const moment = this.moments[this.index];
		const session = this.session;
		this.result(session);
		if (moment === undefined || session === null) return;
		this.parts.chart.replaceChildren(...pickChart(session, this.index));
		this.parts.chart.hidden = this.parts.chart.childElementCount === 0;
		this.parts.side.replaceChildren(decisionPanel(moment, this.part.stepNote?.(moment)));
		this.steps(session);
		this.parts.scrub.max = String(this.last);
		this.parts.scrub.value = String(this.index);
		this.parts.where.textContent = moment.label;
		this.parts.play.textContent = this.playing ? "Pause" : "Play";
		this.parts.play.setAttribute("aria-label", this.playing ? "Pause" : "Play");
	}

	/** The result, without the outcome's fields that the part leaves out. */
	private result(session: Session | null): void {
		this.parts.result.replaceChildren(resultPanel(session, this.waiting, this.part.hidden ?? []));
	}

	/** The part's list of steps; each entry opens its moment. */
	private steps(session: Session): void {
		const open = (target: number) => {
			this.stop();
			this.following = false;
			void this.go(target, false);
		};
		this.parts.steps.replaceChildren(...(this.part.steps?.list(session, this.index, open) ?? []));
		this.reveal();
	}

	/** Scrolls the steps list so that its current entry is in view. */
	private reveal(): void {
		const list = this.parts.steps.firstElementChild;
		const current = list?.querySelector<HTMLElement>(".current") ?? null;
		if (!(list instanceof HTMLElement) || current === null) return;
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
		parts.download.addEventListener("click", () => {
			this.download();
		});
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
		const jumps: Readonly<Record<string, () => void>> = {
			ArrowLeft: () => void this.go(this.goal - 1, false),
			ArrowRight: () => void this.go(this.goal + 1, true),
			Home: () => void this.go(0, false),
			End: () => void this.go(this.last, false),
		};
		const goTo = jumps[event.key];
		if (goTo !== undefined) {
			this.stop();
			goTo();
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

	/** Gives the file that the part offers. */
	private download(): void {
		const offer = this.part.download;
		if (this.session === null || offer === undefined) return;
		const file = offer.file(this.session);
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob([file.text], { type: file.type }));
		link.download = file.name;
		link.click();
		URL.revokeObjectURL(link.href);
	}
}

/** Keys typed into a field, or held with a modifier, belong to the field or the browser. */
function ignored(event: KeyboardEvent): boolean {
	const target = event.target;
	if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return true;
	return event.altKey || event.ctrlKey || event.metaKey;
}

/** Starts the viewer in `root`. */
export function start(root: HTMLElement, config: AppConfig): App {
	return new App(root, config);
}

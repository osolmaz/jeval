// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, type Session, start } from "@osolmaz/switch-viewer/page";
import "../src/web/part.ts";
import type { SoundSet } from "../src/web/sound.ts";
import { clipUrl, type FakeAudioContext, stubAudio } from "./helpers/audio.ts";
import { choosing } from "./helpers/chess.ts";
import { chessSession } from "./helpers/sessions.ts";

const QUICK = { motion: 0, dwell: 0, poll: 5, parts: { chess: { pieces: {} } } } as const;
const withSounds = (sounds: SoundSet) => ({ ...QUICK, parts: { chess: { pieces: {}, sounds } } });

const mounted: ReturnType<typeof start>[] = [];

function mount(config: AppConfig): { root: HTMLElement; app: ReturnType<typeof start> } {
	const root = document.createElement("div");
	document.body.replaceChildren(root);
	const app = start(root, config);
	mounted.push(app);
	return { root, app };
}

const text = (root: HTMLElement, selector: string): string => root.querySelector(selector)?.textContent ?? "";
const click = (root: HTMLElement, selector: string): void => {
	root.querySelector<HTMLElement>(selector)?.click();
};
const label = (root: HTMLElement): string => text(root, "output");

afterEach(() => {
	for (const app of mounted.splice(0)) app.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("the chess part of the page", () => {
	it("opens a saved chess game at its start, with the players and the PGN download", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 2 }) });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		expect(text(root, "h1")).toBe("g1");
		expect(text(root, ".meta")).toBe("chess · fake/decider");
		expect(root.querySelector<HTMLElement>(".live")?.hidden).toBe(true);
		expect(root.querySelector<HTMLElement>("button.download")?.hidden).toBe(false);
		// A saved page has no server, so its header links nowhere.
		expect(root.querySelector("a.home")?.hasAttribute("href")).toBe(false);
		expect(root.querySelectorAll(".piece")).toHaveLength(32);
		expect(Array.from(root.querySelectorAll(".player .name")).map((name) => name.textContent)).toEqual([
			"random legal moves, seed 7",
			"fake/decider",
		]);
		expect(text(root, ".result-slot")).toContain("unfinished · step limit");
		expect(Array.from(root.querySelectorAll(".clock")).map((clock) => clock.className)).toEqual([
			"clock b",
			"clock w active",
		]);
	});

	it("names the model on both sides in self-play, and shows the score of a finished game", async () => {
		const { root } = mount({
			...QUICK,
			session: await chessSession({
				opponent: "self",
				steps: 1,
				policy: choosing(/checkmate/),
				start: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
			}),
		});
		await vi.waitFor(() => {
			expect(Array.from(root.querySelectorAll(".player .name")).map((name) => name.textContent)).toEqual([
				"fake/decider",
				"fake/decider",
			]);
		});
		expect(text(root, ".banner")).toBe("white wins · checkmate");
		expect(text(root, ".plies + .score")).toBe("1-0");
		expect(root.querySelector(".ply .figure")?.getAttribute("alt")).toBe("R");
	});

	it("steps through the moments with the buttons, the slider and the keys", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 2 }) });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 2");
		});
		expect(root.querySelectorAll("polygon.arrow")).toHaveLength(5);
		expect(text(root, ".decision h2")).toBe("The answers");
		expect(text(root, ".decision .step")).toBe("Step 1 of 2 · white to move");
		expect(root.querySelector(".choices .picked")?.textContent).toContain("(picked)");
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		click(root, "button.previous");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 2 of 2");
		});
		click(root, "button.first");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 2");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }));
		const scrub = root.querySelector<HTMLInputElement>('input[type="range"]');
		if (scrub === null) throw new Error("no slider");
		scrub.value = "3";
		scrub.dispatchEvent(new Event("input"));
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
	});

	it("plays the game to its end and stops", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 3 }) });
		click(root, "button.play");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
			expect(text(root, "button.play")).toBe("Play");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
	});

	it("opens a move from the move list, and marks the latest move on the board", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 2 }) });
		await vi.waitFor(() => {
			expect(root.querySelectorAll(".plies li")).toHaveLength(2);
		});
		const replies = Array.from(root.querySelectorAll<HTMLElement>(".ply:not(.model)"));
		replies[0]?.click();
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 2 of 2");
		});
		expect(root.querySelector(".ply.current")?.getAttribute("aria-current")).toBe("step");
		expect(root.querySelector(".ply.model small")?.textContent).toBe("60.0%");
	});

	it("downloads the game as PGN", async () => {
		const made: Blob[] = [];
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			if (blob instanceof Blob) made.push(blob);
			return "blob:pgn";
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 1 }) });
		expect(root.querySelector("button.download")?.getAttribute("aria-label")).toBe("Download the game as PGN");
		click(root, "button.download");
		expect(await made[0]?.text()).toContain('[Event "switch: g1"]');
	});

	it("names its list of steps Moves, and hides the final position from the result", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 1 }) });
		await vi.waitFor(() => {
			expect(text(root, ".timeline h2")).toBe("Moves");
		});
		expect(text(root, ".facts")).toContain("material");
		expect(text(root, ".facts")).not.toContain("fen");
	});

	it("shows the plain view of a moment without a chess state", async () => {
		const session = await chessSession({ steps: 1 });
		const { root } = mount({ ...QUICK, session: { ...session, story: { ...session.story, initial: null } } });
		await vi.waitFor(() => {
			expect(text(root, ".state-card")).toBe("No state yet.");
		});
		expect(root.querySelectorAll(".player")).toHaveLength(0);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(root.querySelectorAll(".piece")).toHaveLength(32);
		});
	});
});

describe("a running case", () => {
	it("waits for the case to start, follows it while it runs, and stops at its end", async () => {
		let current: Session | null = null;
		vi.stubGlobal("fetch", (url: string) => {
			if (url.endsWith("/version")) return Promise.resolve(new Response(current?.version ?? "0:false"));
			return Promise.resolve(current === null ? new Response("no", { status: 404 }) : Response.json(current));
		});
		const { root } = mount({ ...QUICK, sessionUrl: "/s", versionUrl: "/v/version", indexUrl: "/" });
		await vi.waitFor(() => {
			expect(text(root, ".result-slot")).toBe("Waiting for the case to start…");
		});
		current = await chessSession({ steps: 1, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1");
			expect(root.querySelector<HTMLElement>(".live")?.hidden).toBe(false);
		});
		expect(root.querySelector("a.home")?.getAttribute("href")).toBe("/");
		current = await chessSession({ steps: 2, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 2");
		});
		current = await chessSession({ steps: 2 });
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
			expect(root.querySelector<HTMLElement>(".live")?.hidden).toBe(true);
		});
	});

	it("stays where the viewer went back to while the case goes on", async () => {
		let current: Session = await chessSession({ steps: 2, finished: false });
		vi.stubGlobal("fetch", (url: string) =>
			Promise.resolve(url.endsWith("/version") ? new Response(current.version) : Response.json(current)),
		);
		const { root } = mount({ ...QUICK, sessionUrl: "/s", versionUrl: "/v/version" });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 2");
		});
		click(root, "button.first");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		current = await chessSession({ steps: 3, finished: false });
		await vi.waitFor(() => {
			expect(root.querySelector<HTMLInputElement>('input[type="range"]')?.max).toBe("3");
		});
		expect(label(root)).toBe("Start");
	});

	it("shows the choices without probabilities or arrows while the model is answering", async () => {
		const session = await chessSession({ steps: 1, finished: false });
		const frame = session.story.frames[0];
		if (frame === undefined) throw new Error("no step");
		const thinking = {
			...frame,
			answered: false,
			after: null,
			questions: frame.questions.map((question) => ({
				...question,
				answer: null,
				choices: question.choices.map((choice) => ({ ...choice, probability: null, picked: false })),
			})),
		};
		const story = { ...session.story, frames: [thinking] };
		const { root } = mount({ ...QUICK, session: { ...session, story } });
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(text(root, ".decision h2")).toBe("The model is answering…");
		});
		expect(root.querySelectorAll("polygon")).toHaveLength(0);
	});
});

/** The clips that the first fake audio context started since the last call. */
const heard = (made: readonly FakeAudioContext[]): string[] =>
	(made[0]?.started.splice(0) ?? []).map((sound) => sound.clip);

/** The sound button's state: hidden, its text, and whether it is pressed. */
function soundButton(root: HTMLElement): (string | boolean | null)[] {
	const node = root.querySelector<HTMLElement>("button.sound");
	if (node === null) return [];
	return [node.hidden, node.textContent, node.getAttribute("aria-pressed")];
}

const SOUNDS: SoundSet = {
	clips: {
		"start.wav": clipUrl("game-start"),
		"m.wav": clipUrl("move"),
		"x.wav": clipUrl("capture"),
		"c.wav": clipUrl("check"),
		"o.wav": clipUrl("game-over"),
	},
	events: { "game-start": "start.wav", move: "m.wav", capture: "x.wav", check: "c.wav", "game-over": "o.wav" },
};

describe("the chess part's sounds", () => {
	it("play each move's clip as it lands and the ending's clip at the end, once a click lets them, unless off", async () => {
		const made = stubAudio();
		const { root } = mount({ ...withSounds(SOUNDS), session: await chessSession({ steps: 2 }) });
		const next = async (to: string): Promise<void> => {
			click(root, "button.next");
			await vi.waitFor(() => {
				expect(label(root)).toBe(to);
			});
		};
		await next("Step 1 of 2");
		expect(made).toHaveLength(0);
		document.dispatchEvent(new Event("pointerdown"));
		await next("Step 2 of 2");
		// The model's move and the reply: a clip each.
		expect(heard(made)).toHaveLength(2);
		await next("End");
		// The step limit ended this game, which sounds as a plain game over, a moment after the last move.
		expect(made[0]?.started.at(-1)).toEqual({ clip: "game-over", at: 0.25 });
		heard(made);
		expect(soundButton(root)).toEqual([false, "Sound on", "true"]);
		click(root, "button.sound");
		expect(soundButton(root)).toEqual([false, "Sound off", "false"]);
		click(root, "button.previous");
		await next("End");
		expect(heard(made)).toEqual([]);
	});

	it("plays the game-start clip when the board moves on from the start", async () => {
		const made = stubAudio();
		const { root } = mount({ ...withSounds(SOUNDS), session: await chessSession({ steps: 1 }) });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		document.dispatchEvent(new Event("pointerdown"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		click(root, "button.play");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		expect(heard(made)[0]).toBe("game-start");
	});
});

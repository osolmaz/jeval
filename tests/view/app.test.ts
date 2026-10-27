// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/core/index.ts";
import { storyOf } from "../../src/view/frames.ts";
import { type AppConfig, start } from "../../src/view/web/app.ts";
import type { Session } from "../../src/view/web/model.ts";
import { answering, factsDomain, fakeDecider } from "../helpers/fakes.ts";
import { picking } from "../helpers/chess.ts";
import { chessSession } from "../helpers/sessions.ts";

const QUICK = { pieces: {}, motion: 0, dwell: 0, poll: 5 } as const;

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
});

describe("the viewer", () => {
	it("opens a saved chess game at its start, with the players and the PGN download", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 2 }) });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		expect(text(root, "h1")).toBe("g1");
		expect(text(root, ".meta")).toBe("chess · fake/decider");
		expect(root.querySelector<HTMLElement>(".live")?.hidden).toBe(true);
		expect(root.querySelector<HTMLElement>("button.download")?.hidden).toBe(false);
		expect(root.querySelector<HTMLElement>("a.download")?.hidden).toBe(true);
		expect(root.querySelectorAll(".piece")).toHaveLength(32);
		expect(Array.from(root.querySelectorAll(".player .name")).map((name) => name.textContent)).toEqual([
			"random legal moves, seed 7",
			"fake/decider",
		]);
		expect(text(root, ".result-slot")).toContain("unfinished · move limit");
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
				policy: picking(/checkmate/),
				start: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
			}),
		});
		await vi.waitFor(() => {
			expect(Array.from(root.querySelectorAll(".player .name")).map((name) => name.textContent)).toEqual([
				"fake/decider",
				"fake/decider",
			]);
		});
		expect(text(root, ".banner")).toBe("1-0white wins · checkmate");
		expect(root.querySelector(".ply .figure")?.getAttribute("alt")).toBe("R");
	});

	it("steps through the moments with the buttons, the slider and the keys", async () => {
		const { root } = mount({ ...QUICK, session: await chessSession({ steps: 2 }) });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 2");
		});
		expect(root.querySelectorAll("polygon.arrow")).toHaveLength(5);
		expect(text(root, ".decision h2")).toBe("The model's options");
		expect(text(root, ".decision .step")).toBe("Step 1 of 2 · white to move");
		expect(root.querySelector(".menu .chosen")?.textContent).toContain("(chosen)");
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
		click(root, "button.download");
		expect(await made[0]?.text()).toContain('[Event "switch: g1"]');
	});

	it("shows what a case without a board saw", async () => {
		const result = await run(
			factsDomain,
			{ facts: { a: "fact a" } },
			fakeDecider(answering(0.6, (labels) => labels[0] ?? "stop")),
			{
				case: "facts-1",
			},
		);
		const session: Session = { story: storyOf(result.trace.entries), outcome: null, finished: true, version: "1" };
		const { root } = mount({ ...QUICK, session });
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(text(root, ".found-card")).toBe("fact a");
		});
		expect(root.querySelector<HTMLElement>("button.download")?.hidden).toBe(true);
		expect(text(root, ".result-slot")).toBe("The case ended without an outcome.");
	});
});

describe("a running case", () => {
	it("waits for the case to start, follows it while it runs, and stops at its end", async () => {
		let current: Session | null = null;
		vi.stubGlobal("fetch", (url: string) => {
			if (url.endsWith("/version")) return Promise.resolve(new Response(current?.version ?? "0:false"));
			return Promise.resolve(current === null ? new Response("no", { status: 404 }) : Response.json(current));
		});
		const { root } = mount({ ...QUICK, sessionUrl: "/s", versionUrl: "/v/version", pageUrl: "/p" });
		await vi.waitFor(() => {
			expect(text(root, ".result-slot")).toBe("Waiting for the case to start…");
		});
		current = await chessSession({ steps: 1, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1");
			expect(root.querySelector<HTMLElement>(".live")?.hidden).toBe(false);
		});
		expect(root.querySelector("a.download")?.getAttribute("href")).toBe("/p");
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

	it("shows the options without probabilities or arrows while the model is choosing", async () => {
		const session = await chessSession({ steps: 1, finished: false });
		const frame = session.story.frames[0];
		if (frame === undefined) throw new Error("no step");
		const thinking = {
			...frame,
			chosen: null,
			after: null,
			options: frame.options.map((option) => ({ ...option, probability: null, chosen: false })),
		};
		const story = { ...session.story, frames: [thinking] };
		const { root } = mount({ ...QUICK, session: { ...session, story } });
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(text(root, ".decision h2")).toBe("The model is choosing…");
		});
		expect(root.querySelectorAll("polygon")).toHaveLength(0);
	});
});

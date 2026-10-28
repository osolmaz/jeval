// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, start } from "../../src/view/web/app.ts";
import type { Moment, Session } from "../../src/view/web/model.ts";
import { button, h } from "../../src/view/web/panels.ts";
import { type PartContext, partOf, registerPart } from "../../src/view/web/part.ts";
import { factsSession } from "../helpers/sessions.ts";

const QUICK = { motion: 0, dwell: 0, poll: 5 } as const;

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
const hidden = (root: HTMLElement, selector: string): boolean =>
	root.querySelector<HTMLElement>(selector)?.hidden === true;

afterEach(() => {
	for (const app of mounted.splice(0)) app.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("the viewer, for a domain without a part", () => {
	it("opens a saved case at its start, with the initial state as JSON and the result", async () => {
		const { root } = mount({ ...QUICK, session: await factsSession() });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		expect(text(root, "h1")).toBe("f1");
		expect(text(root, ".meta")).toBe("facts · fake/decider");
		expect([hidden(root, ".live"), hidden(root, "button.download"), hidden(root, "button.sound")]).toEqual([
			true,
			true,
			true,
		]);
		// A saved page has no server, so its header links nowhere.
		expect(root.querySelector("a.home")?.hasAttribute("href")).toBe(false);
		expect(JSON.parse(text(root, ".found-card"))).toEqual({ looked: [], found: [] });
		expect(text(root, ".timeline h2")).toBe("Result");
		expect(text(root, ".banner")).toBe("answered · the model stopped");
		expect(text(root, ".facts")).toContain("looked2");
		expect(text(root, ".facts")).toContain("ayes 70.0%");
	});

	it("steps through the moments with the buttons, the slider and the keys", async () => {
		const { root } = mount({ ...QUICK, session: await factsSession() });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 3");
		});
		expect(text(root, ".decision h2")).toBe("The choices");
		expect(text(root, ".decision .step")).toBe("Step 1 of 3");
		expect(root.querySelector(".choices .picked")?.textContent).toContain("(picked)");
		expect(text(root, ".decision h3")).toBe("What changed");
		expect(Array.from(root.querySelectorAll(".found")).map((line) => line.textContent)).toEqual([
			"looked + a",
			"found + fact a",
		]);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(JSON.parse(text(root, ".found-card"))).toEqual({ looked: ["a"], found: ["fact a"] });
		});
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		click(root, "button.previous");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 3 of 3");
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
			expect(label(root)).toBe("Step 1 of 3");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }));
		const scrub = root.querySelector<HTMLInputElement>('input[type="range"]');
		if (scrub === null) throw new Error("no slider");
		scrub.value = "4";
		scrub.dispatchEvent(new Event("input"));
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
	});

	it("plays the case to its end and stops", async () => {
		const { root } = mount({ ...QUICK, session: await factsSession() });
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
		current = await factsSession({ steps: 0, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1");
			expect(hidden(root, ".live")).toBe(false);
		});
		expect(text(root, ".result-slot")).toBe("The case is running.");
		expect(root.querySelector("a.home")?.getAttribute("href")).toBe("/");
		current = await factsSession({ steps: 1, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 2");
		});
		current = await factsSession({ steps: 1 });
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
			expect(hidden(root, ".live")).toBe(true);
		});
	});

	it("stays where the viewer went back to while the case goes on", async () => {
		let current: Session = await factsSession({ steps: 1, finished: false });
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
		current = await factsSession({ steps: 2, finished: false });
		await vi.waitFor(() => {
			expect(root.querySelector<HTMLInputElement>('input[type="range"]')?.max).toBe("3");
		});
		expect(label(root)).toBe("Start");
	});

	it("shows the choices without probabilities while the model is picking, and a case without an outcome", async () => {
		const session = await factsSession({ steps: 1, finished: false });
		const frame = session.story.frames[0];
		if (frame === undefined) throw new Error("no step");
		const thinking = {
			...frame,
			picked: null,
			after: null,
			choices: frame.choices.map((choice) => ({ ...choice, probability: null, picked: false })),
		};
		const story = { ...session.story, frames: [thinking] };
		const { root } = mount({ ...QUICK, session: { ...session, finished: true, story } });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".decision h2")).toBe("The model is picking from the choices…");
		});
		expect(Array.from(root.querySelectorAll(".choices .p")).map((p) => p.textContent)).toEqual(["–", "–", "–", "–"]);
		expect(text(root, ".result-slot")).toBe("The case ended without an outcome.");
	});
});

/** What the fake part was asked, in order. */
const asked: string[] = [];
let context: PartContext | null = null;

registerPart("fake", (given) => {
	context = given;
	return {
		stage: (moment: Moment, from: Moment | null) => {
			asked.push(`stage ${moment.label}${from === null ? "" : ` from ${from.label}`}`);
			return Promise.resolve(moment.type === "end" ? null : h("div", { class: "drawn" }, moment.label));
		},
		bars: (moment: Moment) => ({ top: h("p", { class: "top" }, `above ${moment.label}`), bottom: null }),
		stepNote: () => " · a note",
		steps: {
			title: "Facts",
			list: (_session, index, open) =>
				[
					h(
						"ol",
						{},
						...[1, 2].map((at) =>
							h(
								"li",
								at === index ? { class: "current" } : {},
								button(`fact ${String(at)}`, `jump${String(at)}`, ""),
							),
						),
					),
				].map((list) => {
					list.querySelector(".jump2")?.addEventListener("click", () => {
						open(2);
					});
					return list;
				}),
		},
		score: () => "9-9",
		hidden: ["looked"],
		download: {
			label: "Download the facts",
			text: "Facts",
			file: (session) => ({ name: "facts.txt", type: "text/plain", text: session.story.case }),
		},
		sound: {
			enabled: true,
			toggle: () => asked.push("toggle"),
			wake: () => asked.push("wake"),
			started: () => asked.push("started"),
			ended: () => asked.push("ended"),
		},
	};
});

describe("a domain's part of the page", () => {
	it("draws the stage, the bars, the note, the steps list, the score and the buttons that the part gives", async () => {
		asked.length = 0;
		const session = await factsSession();
		const { root } = mount({
			...QUICK,
			parts: { fake: { color: "blue" } },
			session: { ...session, story: { ...session.story, domain: "fake" } },
		});
		await vi.waitFor(() => {
			expect(text(root, ".drawn")).toBe("Start");
		});
		expect(context?.config).toEqual({ color: "blue" });
		expect([context?.motion(), context?.gap()]).toEqual([0, 0]);
		expect(text(root, ".top")).toBe("above Start");
		expect(text(root, ".timeline h2")).toBe("Facts");
		expect(text(root, ".banner")).toBe("9-9answered · the model stopped");
		expect(text(root, ".facts")).not.toContain("looked");
		expect([hidden(root, "button.download"), text(root, "button.download")]).toEqual([false, "Facts"]);
		expect([hidden(root, "button.sound"), text(root, "button.sound")]).toEqual([false, "Sound on"]);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".decision .step")).toBe("Step 1 of 3 · a note");
		});
		expect(asked).toContain("stage Step 1 of 3 from Start");
		click(root, "button.jump2");
		await vi.waitFor(() => {
			expect(text(root, ".drawn")).toBe("Step 2 of 3");
		});
		expect(root.querySelector(".current .jump2")).not.toBeNull();
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(JSON.parse(text(root, ".found-card"))).toEqual({ looked: ["a", "b"], found: ["fact a", "fact b"] });
		});
	});

	it("passes clicks, keys, playing and the end to the part's sound, and downloads the part's file", async () => {
		asked.length = 0;
		const made: Blob[] = [];
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			if (blob instanceof Blob) made.push(blob);
			return "blob:facts";
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const session = await factsSession({ steps: 0 });
		const { root } = mount({ ...QUICK, session: { ...session, story: { ...session.story, domain: "fake" } } });
		await vi.waitFor(() => {
			expect(text(root, ".drawn")).toBe("Start");
		});
		document.dispatchEvent(new Event("pointerdown"));
		click(root, "button.sound");
		click(root, "button.download");
		expect(await made[0]?.text()).toBe("f1");
		click(root, "button.play");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		expect(asked.filter((call) => !call.startsWith("stage"))).toEqual(["wake", "toggle", "started"]);
		click(root, "button.previous");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 1");
		});
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		// The fake part draws no end, so the page shows the plain text there and plays no end sound.
		expect(asked).not.toContain("ended");
	});

	it("is no part at all for a domain that registered none", () => {
		expect(partOf("unknown", { config: {}, motion: () => 0, gap: () => 0 })).toEqual({});
	});
});

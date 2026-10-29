// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, start } from "../src/web/app.ts";
import type { Moment, Session } from "../src/web/model.ts";
import { button, h } from "../src/web/panels.ts";
import { type PartContext, partOf, registerPart } from "../src/web/part.ts";
import { factsSession } from "./helpers/sessions.ts";

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
		expect(document.documentElement.dataset["domain"]).toBe("facts");
		expect(text(root, ".meta")).toBe("facts · fake/decider");
		expect([hidden(root, ".live"), hidden(root, "button.download")]).toEqual([true, true]);
		// A saved page has no server, so its header links nowhere.
		expect(root.querySelector("a.home")?.hasAttribute("href")).toBe(false);
		expect(JSON.parse(text(root, ".state-card"))).toEqual({ looked: [], found: [], stopped: false, answers: null });
		expect(text(root, ".timeline h2")).toBe("Result");
		expect(text(root, ".banner")).toBe("answered · the model stopped");
		expect(text(root, ".facts")).toContain("looked2");
	});

	it("steps through the moments with the buttons, the slider and the keys", async () => {
		const { root } = mount({ ...QUICK, session: await factsSession() });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 1 of 4");
		});
		expect(text(root, ".decision h2")).toBe("The answers");
		expect(text(root, ".decision .step")).toBe("Step 1 of 4");
		expect(root.querySelector(".choices .picked")?.textContent).toContain("(picked)");
		expect(text(root, ".decision h3")).toBe("What changed");
		expect(Array.from(root.querySelectorAll(".change")).map((line) => line.textContent)).toEqual([
			"looked + a",
			"found + fact a",
		]);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(JSON.parse(text(root, ".state-card"))).toEqual({
				looked: ["a"],
				found: ["fact a"],
				stopped: false,
				answers: null,
			});
		});
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		click(root, "button.previous");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 4 of 4");
		});
		// The last step's yes-or-no answers are listed under their questions' ids.
		expect(text(root, ".decision .facts")).toContain("ayes 70.0%");
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
			expect(label(root)).toBe("Step 1 of 4");
		});
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }));
		const scrub = root.querySelector<HTMLInputElement>('input[type="range"]');
		if (scrub === null) throw new Error("no slider");
		scrub.value = "5";
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
			expect(label(root)).toBe("Step 2");
			expect(hidden(root, ".live")).toBe(false);
		});
		expect(text(root, ".result-slot")).toContain("The case is running.");
		expect(root.querySelector("a.home")?.getAttribute("href")).toBe("/");
		current = await factsSession({ steps: 1, finished: false });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 3");
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
			expect(label(root)).toBe("Step 3");
		});
		click(root, "button.first");
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		current = await factsSession({ steps: 2, finished: false });
		await vi.waitFor(() => {
			expect(root.querySelector<HTMLInputElement>('input[type="range"]')?.max).toBe("4");
		});
		expect(label(root)).toBe("Start");
	});

	it("shows the choices without probabilities while the model is answering, and a case without an outcome", async () => {
		const session = await factsSession({ steps: 1, finished: false });
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
		const { root } = mount({ ...QUICK, session: { ...session, finished: true, story } });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".decision h2")).toBe("The model is answering…");
		});
		expect(Array.from(root.querySelectorAll(".choices .p")).map((p) => p.textContent)).toEqual(["–", "–", "–", "–"]);
		expect(root.querySelector(".banner")).toBeNull();
		expect(text(root, ".result-slot")).toContain("The case ended with no outcome.");
	});

	it("says that a step failed, with the reason, where the model gave no answers", async () => {
		const session = await factsSession({ steps: 1 });
		const frame = session.story.frames[0];
		if (frame === undefined) throw new Error("no step");
		const failed = { ...frame, answered: false, failed: "down", after: null };
		const story = { ...session.story, frames: [failed], ended: "failed" as const, error: "down" };
		const { root } = mount({ ...QUICK, session: { ...session, story } });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".decision h2")).toBe("The step failed");
		});
		expect(text(root, ".decision")).toContain("down");
	});

	it("says when the run failed, a step limit ended it, or the case failed before or after its run ended", async () => {
		const session = await factsSession({ steps: 1 });
		const show = async (story: Partial<typeof session.story>, finished = true): Promise<string> => {
			const { root, app } = mount({
				...QUICK,
				session: { ...session, finished, story: { ...session.story, ...story } },
			});
			await vi.waitFor(() => {
				expect(label(root)).toBe("Start");
			});
			app.close();
			return text(root, ".result-slot");
		};
		expect(await show({ ended: "failed", error: "too long" })).toContain("The run failed: too long");
		expect(await show({ ended: "step limit" })).toContain("The step limit ended the run early.");
		expect(await show({ ended: null, thrown: "broken" })).toContain("The case failed before its run ended: broken");
		expect(await show({ thrown: "no outcome" })).toContain("The case failed after its run ended: no outcome");
		const frame = session.story.frames[0];
		if (frame === undefined) throw new Error("no step");
		const cut = { ...frame, questions: frame.questions.map((question) => ({ ...question, cut: 2 })) };
		const { root: cutRoot } = mount({
			...QUICK,
			session: { ...session, story: { ...session.story, frames: [cut] } },
		});
		click(cutRoot, "button.next");
		await vi.waitFor(() => {
			expect(text(cutRoot, ".decision")).toContain("The limit cut 2 more, which the model did not see.");
		});
		const { root } = mount({ ...QUICK, session: { ...session, outcome: null, summary: null } });
		await vi.waitFor(() => {
			expect(text(root, ".result-slot")).toBe("The case ended with no outcome.");
		});
	});
});

/** What the fake part was asked, in order. */
const asked: string[] = [];
let context: PartContext | null = null;

registerPart("fake", (given) => {
	context = given;
	return {
		draw: (moment: Moment, from: Moment | null, session: Session) => {
			asked.push(`draw ${moment.label}${from === null ? "" : ` from ${from.label}`} of ${session.story.case}`);
			return Promise.resolve(moment.type === "end" ? null : h("div", { class: "drawn" }, moment.label));
		},
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
		hidden: ["looked"],
		download: {
			label: "Download the facts",
			text: "Facts",
			file: (session) => ({ name: "facts.txt", type: "text/plain", text: session.story.case }),
		},
	};
});

describe("a domain's part of the page", () => {
	it("shows the drawing, the note, the steps list and the download button that the part gives", async () => {
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
		expect(text(root, ".timeline h2")).toBe("Facts");
		expect(text(root, ".banner")).toBe("answered · the model stopped");
		expect(text(root, ".facts")).not.toContain("looked");
		expect([hidden(root, "button.download"), text(root, "button.download")]).toEqual([false, "Facts"]);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".decision .step")).toBe("Step 1 of 4 · a note");
		});
		expect(asked).toContain("draw Step 1 of 4 from Start of f1");
		click(root, "button.jump2");
		await vi.waitFor(() => {
			expect(text(root, ".drawn")).toBe("Step 2 of 4");
		});
		expect(root.querySelector(".current .jump2")).not.toBeNull();
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(JSON.parse(text(root, ".state-card"))).toEqual({
				looked: ["a", "b"],
				found: ["fact a", "fact b"],
				stopped: true,
				answers: { a: 0.7, b: 0.7, c: 0.7 },
			});
		});
	});

	it("plays the case through the part's drawing up to the end, and downloads the part's file", async () => {
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
		click(root, "button.download");
		expect(await made[0]?.text()).toBe("f1");
		click(root, "button.play");
		await vi.waitFor(() => {
			expect(label(root)).toBe("End");
		});
		expect(asked).toEqual([
			"draw Start of f1",
			"draw Step 1 of 2 from Start of f1",
			"draw Step 2 of 2 from Step 1 of 2 of f1",
			"draw End from Step 2 of 2 of f1",
		]);
		// The fake part draws no end, so the page shows the state as JSON there.
		expect(root.querySelector(".state-card")).not.toBeNull();
	});

	it("is no part at all for a domain that registered none", () => {
		expect(partOf("unknown", { config: {}, motion: () => 0, gap: () => 0 })).toEqual({});
	});
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PICK_ID } from "@osolmaz/switch";
import { answered } from "@osolmaz/switch/testing";
import { type AppConfig, type Moment, momentsOf, type Session, start } from "@osolmaz/switch-viewer/page";
import { TEXTS } from "../src/race.ts";
import { raceFork, raceOf, raceSteps } from "../src/web/data.ts";
import { racePart } from "../src/web/part.ts";
import { articleUrl } from "../src/web/route.ts";
import { following, raceSession } from "./helpers/sessions.ts";
import { manyLinks } from "./helpers/wiki.ts";

const QUICK = { motion: 0, dwell: 0, poll: 5, parts: { wikirace: {} } } as const;
const mounted: ReturnType<typeof start>[] = [];

function mount(config: AppConfig): HTMLElement {
	const root = document.createElement("div");
	document.body.replaceChildren(root);
	mounted.push(start(root, config));
	return root;
}

const texts = (root: ParentNode, selector: string): (string | null)[] =>
	[...root.querySelectorAll(selector)].map((item) => item.textContent);
const text = (root: ParentNode, selector: string): string => root.querySelector(selector)?.textContent ?? "";
const click = (root: HTMLElement, selector: string): void => {
	root.querySelector<HTMLElement>(selector)?.click();
};
const label = (root: HTMLElement): string => text(root, "output");
/** The moments of a session, as the page has them. */
const momentAt = (session: Session, index: number): Moment => {
	const moment = momentsOf(session.story, session.finished)[index];
	if (moment === undefined) throw new Error(`no moment ${String(index)}`);
	return moment;
};
/** A part that moves things for `motion` milliseconds. */
const partWith = (motion: number) => racePart({ config: {}, motion: () => motion, gap: () => 0 });

afterEach(() => {
	for (const app of mounted.splice(0)) app.close();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("what the wikirace part reads", () => {
	it("reads a race from a state, and nothing from another state", async () => {
		const session = await raceSession();
		expect(raceOf(session.story.initial)).toEqual({
			target: "Moon",
			path: [{ title: "Duck", via: "Duck" }],
			section: null,
			gaveUp: false,
			last: "The race starts at Duck.",
		});
		expect(raceOf({ moves: [] })).toBeNull();
		expect(raceOf(null)).toBeNull();
	});

	it("reads each step's article and picked branch, and a step's likeliest branches", async () => {
		const session = await raceSession();
		expect(
			raceSteps(session).map((step) => [step.moment, step.from, step.picked?.name, step.picked?.probability]),
		).toEqual([
			[1, "Duck", "Bird", 0.6],
			[2, "Bird", "Sky", 0.6],
			[3, "Sky", "Moon", 0.6],
		]);
		const fork = raceFork(momentAt(session, 1), 3);
		expect(fork).toMatchObject({ total: 5, cut: 0, answered: true });
		expect(fork?.shown.map((branch) => [branch.name, branch.type, branch.picked])).toEqual([
			["Bird", "link", true],
			["Water", "link", false],
			["Pond", "link", false],
		]);
		expect(raceFork(momentAt(session, 0), 3)).toBeNull();
	});

	it("keeps the picked branch among the shown ones, and shows the article's order before the model answers", async () => {
		// The model picks Pond, its third likeliest link.
		const session = await raceSession({
			steps: 1,
			policy: () =>
				answered({
					[PICK_ID]: {
						type: "choice",
						choice: "o3",
						probabilities: { o1: 0.5, o2: 0.3, o3: 0.1, o4: 0.06, o5: 0.04 },
						confidence: 0.2,
					},
				}),
		});
		const step = momentAt(session, 1);
		expect(raceFork(step, 2)?.shown.map((branch) => branch.name)).toEqual(["Bird", "Pond"]);
		const frame = step.frame;
		if (frame === null) throw new Error("no frame");
		const unanswered = {
			...frame,
			answered: false,
			questions: frame.questions.map((question) => ({
				...question,
				answer: null,
				choices: question.choices.map((choice) => ({ ...choice, probability: null, picked: false })),
			})),
		};
		const before = raceFork({ ...step, frame: unanswered }, 2);
		expect(before).toMatchObject({ answered: false, shown: [{ name: "Bird" }, { name: "Water" }] });
	});
});

describe("the wikirace part of the page", () => {
	it("draws the start: from where to which article, no hops yet, and the target apart", async () => {
		const root = mount({ ...QUICK, session: await raceSession() });
		await vi.waitFor(() => {
			expect(label(root)).toBe("Start");
		});
		expect(text(root, ".race-title")).toBe("Duck → Moon");
		expect(text(root, ".race-score")).toBe("0 hopsracing");
		expect(texts(root, ".race-stop a")).toEqual(["Duck", "Moon"]);
		expect(root.querySelector(".race-gap")).not.toBeNull();
		expect(root.querySelector(".race-fork")).toBeNull();
		const duck = root.querySelector<HTMLAnchorElement>(".race-stop a");
		expect([duck?.getAttribute("href"), duck?.target, duck?.rel]).toEqual([
			articleUrl("Duck"),
			"_blank",
			"noopener noreferrer",
		]);
		expect(articleUrl("Rubber duck")).toBe("https://en.wikipedia.org/wiki/Rubber_duck");
	});

	it("draws a step's branches from its article, likeliest first, with the picked one marked", async () => {
		const root = mount({ ...QUICK, session: await raceSession() });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".race-fork-title")).toBe("5 choices at Duck, by the model's probability");
		});
		expect(texts(root, ".race-branch .race-name")).toEqual(["Bird", "Water", "Pond", "Rubber duck", TEXTS.giveUp]);
		expect(texts(root, ".race-branch.race-picked .race-name")).toEqual(["Bird"]);
		expect(texts(root, ".race-p")[0]).toBe("60.0%");
		expect(root.querySelectorAll(".race-curve")).toHaveLength(5);
		expect(root.querySelectorAll(".race-curve.race-picked")).toHaveLength(1);
		expect(text(root, ".race-node")).toBe("Duck");
	});

	it("lists the steps beside the drawing, each opening its step, and ends at the target", async () => {
		const root = mount({ ...QUICK, session: await raceSession() });
		await vi.waitFor(() => {
			expect(texts(root, ".race-step .race-dest")).toEqual(["Bird", "Sky", "Moon"]);
		});
		expect(text(root, ".timeline h2")).toBe("Steps");
		root.querySelectorAll<HTMLElement>(".race-step")[2]?.click();
		await vi.waitFor(() => {
			expect(label(root)).toBe("Step 3 of 3");
		});
		expect(root.querySelector(".race-step.current")?.getAttribute("aria-current")).toBe("step");
		click(root, "button.latest");
		await vi.waitFor(() => {
			expect(text(root, ".race-status")).toBe("reached");
		});
		expect(text(root, ".race-score strong")).toBe("3");
		expect(texts(root, ".race-goal a")).toEqual(["Moon"]);
		expect(root.querySelector(".race-gap")).toBeNull();
		expect(text(root, ".result-slot")).toContain("reached · 3 hops");
	});

	it("names a section with its links, and the section that a step shows", async () => {
		// Duck has more links than one step shows, so a step shows its lead and offers its other section.
		const history = [...manyLinks(79, "H"), "Moon"];
		const pages = { Duck: { Lead: manyLinks(150, "L"), History: history }, Moon: { Lead: [] } };
		const opened = await raceSession({
			pages,
			policy: following(['Open section 1, "History": H 1, H 2, H 3 and 77 more', "Moon"]),
		});
		const first = raceFork(momentAt(opened, 1), 8)?.shown[0];
		expect(first).toMatchObject({ type: "section", name: "History", links: 80, picked: true });
		const root = mount({ ...QUICK, session: opened });
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".race-section")).toBe("§ History · 80 links");
		});
		expect(texts(root, ".race-step .race-dest")).toEqual(["§ History", "Moon"]);
		click(root, "button.next");
		await vi.waitFor(() => {
			expect(text(root, ".race-fork-title")).toBe(
				"82 choices at Duck, section “History”, by the model's probability",
			);
		});
	});

	/** The part's drawing of `moment`, which must be one. */
	async function drawn(moment: Moment, from: Moment | null, session: Session, motion = 0): Promise<HTMLElement> {
		const drawing = await partWith(motion).draw?.(moment, from, session);
		if (drawing === undefined || drawing === null) throw new Error("no drawing");
		return drawing;
	}

	it("says when a race gave up, or ended at a dead end", async () => {
		const quit = await raceSession({ policy: following([TEXTS.giveUp]) });
		expect(raceSteps(quit)[0]?.picked).toMatchObject({ type: "give-up" });
		expect(text(await drawn(momentAt(quit, 2), null, quit), ".race-status")).toBe("gave up");
		const pages = { Duck: { Lead: ["Pond"] }, Pond: { Lead: [] } };
		const stuck = await raceSession({ pages, policy: following(["Pond"]) });
		expect(text(await drawn(momentAt(stuck, 2), null, stuck), ".race-status")).toBe("dead end");
	});

	it("moves the new article and the branches in when the page steps forward", async () => {
		const session = await raceSession();
		const moved = await drawn(momentAt(session, 2), momentAt(session, 1), session, 300);
		expect(moved.classList.contains("race-moving")).toBe(true);
		expect(moved.style.getPropertyValue("--race-motion")).toBe("300ms");
		expect(texts(moved, ".race-arrived a")).toEqual(["Bird"]);
		const still = await drawn(momentAt(session, 2), null, session, 300);
		expect(still.classList.contains("race-moving")).toBe(false);
	});

	it("draws nothing for another state, notes each step's article, and hides the path in the result", async () => {
		const session = await raceSession();
		const part = partWith(0);
		const step = momentAt(session, 1);
		await expect(part.draw?.({ ...step, state: null }, null, session)).resolves.toBeNull();
		expect(part.stepNote?.(step)).toBe(" · at Duck");
		expect(part.stepNote?.({ ...step, state: null })).toBe("");
		expect(part.hidden).toEqual(["path"]);
	});
});

// @vitest-environment happy-dom
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PICK_ID } from "@osolmaz/switch";
import { resultSchema, runCases } from "@osolmaz/switch/cli";
import { answered, fakeDecider, type Policy } from "@osolmaz/switch/testing";
import { loadRace } from "../src/case.ts";
import { wikiraceSetup } from "../src/setup.ts";
import { wikiraceViewer } from "../src/viewer.ts";
import type { Moment } from "@osolmaz/switch-viewer/page";
import { racePart, raceTrailOf } from "../src/web/part.ts";
import { fakeWiki, PAGES } from "./helpers/wiki.ts";

let folder = "";
beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "wikirace-"));
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

/** Picks the choice with `title` as its text when there is one, else the first link. */
const toward =
	(title: string): Policy =>
	(request) => {
		const question = request.decisionQuestions[PICK_ID];
		const texts = question?.type === "choice" ? Object.entries(question.criteria) : [];
		const label = texts.find(([, text]) => text === title)?.[0] ?? texts[0]?.[0] ?? "o1";
		return answered({
			[PICK_ID]: { type: "choice", choice: label, probabilities: { [label]: 0.8 }, confidence: 0.7 },
		});
	};

describe("the wikirace harness", () => {
	it("runs a case folder's race, and records how it ended", async () => {
		const race = join(folder, "cases", "duck-to-pond");
		await mkdir(race, { recursive: true });
		await writeFile(join(race, "case.json"), JSON.stringify({ id: "duck-to-pond", start: "Duck", target: "Pond" }));
		expect(await loadRace(race)).toEqual({ id: "duck-to-pond", start: "Duck", target: "Pond" });
		const out = join(folder, "run");
		const lines: string[] = [];
		const progress = (line: string) => lines.push(line);
		await runCases(await wikiraceSetup(fakeWiki(PAGES)), [race], fakeDecider(toward("Pond")), {
			out,
			concurrency: 1,
			progress,
		});
		const result = resultSchema.parse(
			JSON.parse(await readFile(join(out, "cases", "duck-to-pond", "result.json"), "utf8")),
		);
		expect(result).toMatchObject({ steps: 1, ended: "done", thrown: null });
		expect(result.outcome).toEqual({ result: "reached", hops: 1, path: ["Duck", "Pond"] });
		// Reaching the target ends the run, as the target offers no choices.
		expect(lines).toEqual(['duck-to-pond: 1 steps, {"result":"reached","hops":1,"path":["Duck","Pond"]}']);
		expect(wikiraceViewer.summary?.(result.outcome ?? {})).toBe("reached · 1 hops");
		await expect(wikiraceViewer.config()).resolves.toEqual({});
	});

	it("refuses a case file with a missing or an unknown field", async () => {
		await writeFile(join(folder, "case.json"), JSON.stringify({ id: "x", start: "Duck" }));
		await expect(loadRace(folder)).rejects.toThrow();
		await writeFile(join(folder, "case.json"), JSON.stringify({ id: "x", start: "A", target: "B", extra: 1 }));
		await expect(loadRace(folder)).rejects.toThrow();
	});
});

describe("the wikirace part of the page", () => {
	const state = {
		target: "Moon",
		path: [
			{ title: "Duck", via: "Duck" },
			{ title: "Bird", via: "Bird" },
		],
		sections: [
			{ name: "Lead", links: ["Sky"] },
			{ name: "Flight", links: ["Air"] },
		],
		open: 1,
		opened: [1],
		last: "",
	};
	const moment = { type: "step" as const, label: "Step 2", state, frame: null };

	it("reads the trail of a race's state, and nothing of another state", () => {
		expect(raceTrailOf(state)).toEqual({ target: "Moon", titles: ["Duck", "Bird"], section: "Flight" });
		expect(raceTrailOf({ ...state, open: null })?.section).toBeNull();
		expect(raceTrailOf({ moves: [] })).toBeNull();
		expect(raceTrailOf(null)).toBeNull();
	});

	/** The part's drawing of `shown`, which must be one. */
	async function drawingOf(shown: Moment): Promise<HTMLElement> {
		const drawn = await racePart().draw?.(shown, null, {} as never);
		if (drawn === undefined || drawn === null) throw new Error("no drawing");
		return drawn;
	}
	const texts = (root: HTMLElement, selector: string): (string | null)[] =>
		[...root.querySelectorAll(selector)].map((item) => item.textContent);

	it("draws the trail toward the target, and marks the article it is at", async () => {
		const drawn = await drawingOf(moment);
		expect(texts(drawn, ".race-label")).toEqual(["Racing to Moon"]);
		expect(texts(drawn, ".race-trail li")).toEqual(["Duck", "Bird", "…", "Moon"]);
		expect(texts(drawn, ".race-here")).toEqual(["Bird"]);
		expect(texts(drawn, ".race-where")).toEqual(['Showing the section "Flight"']);
	});

	it("draws a reached target without the gap, and nothing for a moment without a state", async () => {
		const path = [...state.path, { title: "Moon", via: "Moon" }];
		const done = await drawingOf({ ...moment, state: { ...state, path, open: null } });
		expect(texts(done, ".race-label")).toEqual(["Reached Moon"]);
		expect(texts(done, ".race-goal")).toEqual([]);
		await expect(racePart().draw?.({ ...moment, state: null }, null, {} as never)).resolves.toBeNull();
	});

	it("notes the article of each step, and hides the path in the result", () => {
		const part = racePart();
		expect(part.stepNote?.(moment)).toBe(" · at Bird");
		expect(part.stepNote?.({ ...moment, state: null })).toBe("");
		expect(part.hidden).toEqual(["path"]);
	});
});

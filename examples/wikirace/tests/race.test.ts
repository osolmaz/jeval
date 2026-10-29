import { describe, expect, it } from "vitest";
import { type BoundChoice, PICK_ID, recordedModel, replayOf, run } from "@osolmaz/switch";
import { answered, answering, fakeDecider, type Policy } from "@osolmaz/switch/testing";
import {
	LINKS,
	openRace,
	outcomeOf,
	raceChoices,
	raceMachine,
	type RaceState,
	raceView,
	reached,
	TEXTS,
	WIKIRACE,
} from "../src/race.ts";
import { fakeWiki, manyLinks, PAGES } from "./helpers/wiki.ts";

const DUCK_TO_MOON = { id: "duck-to-moon", start: "Duck", target: "Moon" };

/** A race of `pages` from Duck to Moon, opened, its state machine, and its choice functions. */
async function raceOf(pages = PAGES) {
	const wiki = fakeWiki(pages);
	const race = await openRace(DUCK_TO_MOON, wiki);
	return { wiki, race, machine: raceMachine(race, wiki), ...raceChoices(wiki) };
}

/** Picks the choice whose text is the first of `route` among the choices; gives up when none is. */
const following =
	(route: readonly string[]): Policy =>
	(request, call) => {
		const question = request.decisionQuestions[PICK_ID];
		if (question?.type !== "choice") return answering(0.5)(request, call);
		const texts = Object.entries(question.criteria);
		const wanted = [...route, TEXTS.giveUp];
		const label = wanted.flatMap((title) => texts.filter(([, text]) => text === title))[0]?.[0] ?? "o1";
		return answered({
			[PICK_ID]: { type: "choice", choice: label, probabilities: { [label]: 0.7 }, confidence: 0.6 },
		});
	};

const keysOf = (choices: readonly BoundChoice<RaceState>[]) => choices.map((choice) => choice.key);

describe("a race", () => {
	it("starts at the start article, with the target's title and summary for every view", async () => {
		const { race } = await raceOf();
		expect(race.initial).toMatchObject({
			target: "Moon",
			path: [{ title: "Duck", via: "Duck" }],
			open: null,
			gaveUp: false,
			last: "The race starts at Duck.",
		});
		expect(raceView(race.initial, race.about).decisionState).toEqual({
			target: "Moon",
			about_the_target: "About Moon.",
			current_article: "Duck",
			path: "Duck",
			showing: "Every link of Duck.",
			last_step: "The race starts at Duck.",
		});
	});

	it("offers every link of a small article, the earlier links first, none to an article visited before, and giving up", async () => {
		const { choices, transition, race } = await raceOf();
		expect(keysOf(choices(race.initial))).toEqual([
			"link:Bird",
			"link:Water",
			"link:Pond",
			"link:Rubber duck",
			"give-up:give-up",
		]);
		const [toBird] = choices(race.initial);
		if (toBird === undefined) throw new Error("no link to Bird");
		const bird = await transition(race.initial, toBird);
		expect(bird).toMatchObject({
			path: [{ title: "Duck" }, { title: "Bird", via: "Bird" }],
			last: 'Followed the link "Bird" to Bird.',
		});
		expect(keysOf(choices(bird))).toEqual(["link:Sky", "link:Feather", "give-up:give-up"]);
	});

	it("gives up with the give-up choice, which a cut never leaves out, and asks nothing more", async () => {
		const { choices, transition, machine, race } = await raceOf();
		const giveUp = choices(race.initial).at(-1);
		if (giveUp === undefined) throw new Error("no choice to give up");
		expect(giveUp).toMatchObject({ type: "give-up", text: TEXTS.giveUp, priority: -1 });
		const gone = await transition(race.initial, giveUp);
		expect(gone).toMatchObject({ gaveUp: true, last: "Gave up the race at Duck." });
		expect(choices(gone)).toEqual([]);
		expect(machine.questions(gone)).toEqual({});
	});

	it("reaches the target without reading it, and has no choices there", async () => {
		const { choices, transition, race, wiki } = await raceOf();
		const sky: RaceState = {
			...race.initial,
			path: [...race.initial.path, { title: "Sky", via: "Sky" }],
			sections: [{ name: "Lead", links: ["Moon"] }],
		};
		const [moon] = choices(sky);
		if (moon === undefined) throw new Error("no link to the target");
		const asked = wiki.asked.length;
		const there = await transition(sky, moon);
		expect(wiki.asked.length).toBe(asked);
		expect(reached(there)).toBe(true);
		expect(choices(there)).toEqual([]);
		expect(raceView(there, "").decisionState["showing"]).toBe("Moon is the target.");
	});
});

describe("an article with more links than one step shows", () => {
	const big = {
		...PAGES,
		Duck: { Lead: manyLinks(150, "Lead link"), History: manyLinks(120, "History link"), Culture: ["Moon"] },
	};

	it("offers the lead's links and the other sections, which each open once to their links", async () => {
		const { choices, transition, race } = await raceOf(big);
		const first = choices(race.initial);
		expect(first.filter((choice) => choice.type === "link")).toHaveLength(150);
		const sections = first.filter((choice) => choice.type === "section");
		expect(sections.map((choice) => [choice.key, choice.text])).toEqual([
			["section:1:1", 'Open section 1, "History": History link 1, History link 2, History link 3 and 117 more'],
			["section:1:2", 'Open section 2, "Culture": Moon'],
		]);
		expect(raceView(race.initial, "").decisionState["showing"]).toBe(
			'The links of the section "Lead" of Duck, and its other sections.',
		);
		const [toHistory] = sections;
		if (toHistory === undefined) throw new Error("no section to open");
		const history = await transition(race.initial, toHistory);
		expect(history).toMatchObject({ open: 1, opened: [1], last: 'Opened the section "History" of Duck.' });
		const then = choices(history);
		expect(then.filter((choice) => choice.type === "link").map((choice) => choice.text)).toEqual(
			manyLinks(120, "History link"),
		);
		expect(keysOf(then.filter((choice) => choice.type === "section"))).toEqual(["section:1:0", "section:1:2"]);
		expect(LINKS).toBeLessThan(TEXTS.choices);
	});
});

describe("a whole race", () => {
	it("follows the model's picks to the target, and the outcome counts the hops", async () => {
		const { machine } = await raceOf();
		const result = await run(WIKIRACE, machine, fakeDecider(following(["Bird", "Sky", "Moon"])));
		expect(result).toMatchObject({ steps: 3, ended: "done" });
		expect(outcomeOf(result)).toEqual({ result: "reached", hops: 3, path: ["Duck", "Bird", "Sky", "Moon"] });
	});

	it("is given up when the model gives up, and unfinished when the steps run out", async () => {
		const { machine } = await raceOf();
		const gaveUp = await run(WIKIRACE, machine, fakeDecider(following([])));
		expect(gaveUp).toMatchObject({ steps: 1, ended: "done" });
		expect(outcomeOf(gaveUp)).toEqual({ result: "gave up", hops: 0, path: ["Duck"] });
		const short = { ...WIKIRACE, limits: { ...WIKIRACE.limits, steps: 1 } };
		const cut = await run(short, machine, fakeDecider(following(["Bird", "Sky", "Moon"])));
		expect(outcomeOf(cut)).toMatchObject({ result: "unfinished", reason: "step limit", hops: 1 });
	});

	it("replays from its trace without reading Wikipedia again", async () => {
		const { machine } = await raceOf();
		const first = await run(WIKIRACE, machine, fakeDecider(following(["Bird", "Sky", "Moon"])));
		const offline = await raceOf();
		const asked = offline.wiki.asked.length;
		const entries = first.trace.entries;
		const again = await run(WIKIRACE, offline.machine, recordedModel(entries), { replay: replayOf(entries) });
		expect(offline.wiki.asked.length).toBe(asked);
		expect(outcomeOf(again)).toEqual(outcomeOf(first));
	});
});

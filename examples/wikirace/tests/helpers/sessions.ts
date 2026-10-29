import { PICK_ID, run } from "@osolmaz/switch";
import { answered, fakeDecider, type Policy } from "@osolmaz/switch/testing";
import { storyOf } from "@osolmaz/switch-viewer";
import type { Session } from "@osolmaz/switch-viewer/page";
import { openRace, outcomeOf, raceMachine, WIKIRACE } from "../../src/race.ts";
import { wikiraceViewer } from "../../src/viewer.ts";
import { fakeWiki, type Pages, PAGES } from "./wiki.ts";

/**
 * Picks the first choice whose text is in `route`, else the first choice, at 0.6; the other choices share the rest, the
 * earlier ones more, so that every choice has a probability.
 */
export const following =
	(route: readonly string[]): Policy =>
	(request) => {
		const question = request.decisionQuestions[PICK_ID];
		const texts = question?.type === "choice" ? Object.entries(question.criteria) : [];
		const label =
			route.flatMap((title) => texts.filter(([, text]) => text === title))[0]?.[0] ?? texts[0]?.[0] ?? "o1";
		const others = texts.filter(([key]) => key !== label);
		const probabilities: Record<string, number> = { [label]: 0.6 };
		others.forEach(([key], index) => {
			probabilities[key] = 0.4 * 2 ** -(index + 1);
		});
		return answered({ [PICK_ID]: { type: "choice", choice: label, probabilities, confidence: 0.5 } });
	};

interface RaceOptions {
	readonly pages: Pages;
	readonly policy: Policy;
	readonly steps: number;
	readonly finished: boolean;
}

const RACE: RaceOptions = { pages: PAGES, policy: following(["Bird", "Sky", "Moon"]), steps: 40, finished: true };

/** A race from Duck to Moon on `pages`, run by `policy`, as the viewer receives it. */
export async function raceSession(options: Partial<RaceOptions> = {}): Promise<Session> {
	const { pages, policy, steps, finished } = { ...RACE, ...options };
	const wiki = fakeWiki(pages);
	const race = await openRace({ id: "duck-to-moon", start: "Duck", target: "Moon" }, wiki);
	const result = await run(
		{ ...WIKIRACE, limits: { ...WIKIRACE.limits, steps } },
		raceMachine(race, wiki),
		fakeDecider(policy),
	);
	const outcome = finished ? outcomeOf(result) : null;
	return {
		story: storyOf(result.trace.entries, "duck-to-moon"),
		outcome,
		summary: outcome === null ? null : (wikiraceViewer.summary?.(outcome) ?? null),
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

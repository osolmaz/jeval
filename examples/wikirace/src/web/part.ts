/// <reference lib="dom" />
/**
 * The wikirace part of the page: the race toward its target, with the route so far and the branches of each step, and
 * the list of the race's steps.
 */
import {
	button,
	type DomainPart,
	h,
	type Moment,
	type PartContext,
	percent,
	registerPart,
	type Session,
} from "@osolmaz/switch-viewer/page";
import { type RaceBranch, raceHere, raceOf, type RaceStep, raceSteps } from "./data.ts";
import { raceDrawing } from "./route.ts";

/** Where a step went: the article, the section it opened, or giving up. */
function whereTo(picked: RaceBranch | null): string {
	if (picked === null) return "…";
	if (picked.type === "section") return `§ ${picked.name}`;
	return picked.type === "give-up" ? "gave up" : picked.name;
}

function stepButton(step: RaceStep, current: boolean, open: (moment: number) => void): HTMLElement {
	const to = whereTo(step.picked);
	const odds = step.picked === null ? "" : percent(step.picked.probability);
	const node = button(
		`Step ${String(step.moment)}: from ${step.from} to ${to}`,
		`race-step${current ? " current" : ""}`,
		"",
	);
	// The article a step left is the one the step before went to, so the list shows only where each step went; the
	// label, which is also the title, names both.
	node.append(
		h("span", { class: "race-n" }, String(step.moment)),
		h("span", { class: "race-dest" }, to),
		h("small", {}, odds),
	);
	if (current) node.setAttribute("aria-current", "step");
	node.addEventListener("click", () => {
		open(step.moment);
	});
	return node;
}

/** The race's steps, each with the article it left, where it went and the model's probability; each opens its step. */
export function raceStepList(session: Session, index: number, open: (moment: number) => void): HTMLElement[] {
	const steps = raceSteps(session);
	if (steps.length === 0) return [];
	const items = steps.map((step) => h("li", {}, stepButton(step, step.moment === index, open)));
	return [h("ol", { class: "race-steps" }, ...items)];
}

/** The article a step was at, after the step's label. */
export function raceNote(moment: Moment): string {
	const race = raceOf(moment.state);
	return race === null ? "" : ` · at ${raceHere(race)}`;
}

/**
 * The wikirace part: it draws each moment of the race. When the page steps forward, the article the step arrived at
 * and the branches move in, for as long as one motion of the page takes.
 */
export function racePart(context: PartContext): DomainPart {
	return {
		draw(moment: Moment, from: Moment | null, session: Session) {
			const race = raceOf(moment.state);
			if (race === null) return Promise.resolve(null);
			const motion = from === null ? 0 : context.motion();
			return Promise.resolve(raceDrawing(moment, session, race, motion));
		},
		stepNote: raceNote,
		steps: { title: "Steps", list: raceStepList },
		hidden: ["path"],
	};
}

registerPart("wikirace", racePart);

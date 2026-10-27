import { choiceKind, type Domain, type Question } from "../../src/core/index.ts";

export { answering, failing, fakeDecider, type Policy } from "../../src/testing/index.ts";

/** A toy domain: a list of named facts the model may look up, and one yes-or-no question per fact. */
export interface Facts {
	readonly facts: Readonly<Record<string, string>>;
}

export const lookUp = choiceKind<Facts, string>({
	name: "look-up",
	menu: (world) =>
		Object.keys(world.facts).map((name) => ({
			key: name,
			text: `Look up ${name}`,
			arg: name,
		})),
	run: (world, name) => ({ source: name, text: world.facts[name] ?? "" }),
});

export const factsDomain: Domain<Facts> = {
	name: "facts",
	version: "1.0.0",
	menu: lookUp,
	stop: "Stop",
	instructions: "Pick the next fact to look up.",
	questions: (world) =>
		Object.keys(world.facts).map((name): Question => ({
			type: "bool",
			id: name,
			instructions: `Is ${name} true?`,
			yes: "yes",
			no: "no",
		})),
	start: () => Promise.resolve([]),
	view: (_, history, purpose, tokens) => ({
		state: { purpose, tokens, seen: history.map((step) => step.observation.text) },
		images: [],
		omitted: tokens < 100 ? ["everything", "the rest"] : [],
	}),
};

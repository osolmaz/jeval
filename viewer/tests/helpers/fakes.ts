import {
	type BoundChoice,
	choiceType,
	type DomainShared,
	joinTypes,
	type JsonObject,
	type Question,
	type StateMachine,
} from "@osolmaz/switch";

export { answered, answering, failing, fakeDecider, type Policy } from "@osolmaz/switch/testing";

/** A toy domain's case: a list of named facts the model may look up, and one yes-or-no question per fact. */
export interface Facts {
	readonly facts: Readonly<Record<string, string>>;
}

/** Where a case of the toy domain is: the facts looked up so far, and what each one said. */
export interface FactsState extends JsonObject {
	readonly looked: readonly string[];
	readonly found: readonly string[];
}

/** The one type of choice of the toy domain: look up a fact not looked up yet. */
export const lookUp = (facts: Facts) =>
	choiceType<FactsState, string>({
		type: "look-up",
		choices: (state) =>
			Object.keys(facts.facts)
				.filter((name) => !state.looked.includes(name))
				.map((name) => ({ key: name, text: `Look up ${name}`, arg: name })),
		transition: (state, name) => ({
			looked: [...state.looked, name],
			found: [...state.found, facts.facts[name] ?? ""],
		}),
	});

export const FACTS: DomainShared = {
	name: "facts",
	version: "1.0.0",
	stop: "Stop",
	instructions: "Pick the next fact to look up.",
	limits: { steps: 8, choices: 30, windowShare: 0.9 },
};

/** The toy domain's state machine for `facts`, starting from `initial`. */
export function factsMachine(
	facts: Facts,
	initial: FactsState = { looked: [], found: [] },
): StateMachine<FactsState, BoundChoice<FactsState>> {
	return {
		initial: () => Promise.resolve(initial),
		...joinTypes(lookUp(facts)),
		view: (state, purpose, tokens) =>
			Promise.resolve({ decisionState: { purpose, tokens, seen: [...state.found] }, decisionImages: [] }),
		questions: () =>
			Object.fromEntries(
				Object.keys(facts.facts).map((name): [string, Question] => [
					name,
					{ type: "bool", instructions: `Is ${name} true?`, criteria: { true: "yes", false: "no" } },
				]),
			),
	};
}

import {
	type Answers,
	choiceType,
	type DomainShared,
	joinTypes,
	type JsonObject,
	picking,
	type Questions,
	type StateMachine,
} from "@osolmaz/switch";

export { answered, answering, failing, fakeDecider, type Policy } from "@osolmaz/switch/testing";

/** A toy domain's case: a list of named facts the model may look up, and one yes-or-no question per fact. */
export interface Facts {
	readonly facts: Readonly<Record<string, string>>;
}

/**
 * Where a case of the toy domain is: the facts looked up so far and what each one said, whether the model stopped
 * looking, and its answers once it gave them.
 */
export interface FactsState extends JsonObject {
	readonly looked: readonly string[];
	readonly found: readonly string[];
	readonly stopped: boolean;
	/** The probability that each fact is true, by fact; null until the model answered. */
	readonly answers: Readonly<Record<string, number>> | null;
}

export const START: FactsState = { looked: [], found: [], stopped: false, answers: null };

/** The first type of choice of the toy domain: look up a fact not looked up yet. */
export const lookUp = (facts: Facts) =>
	choiceType<FactsState, string>({
		type: "look-up",
		choices: (state) =>
			Object.keys(facts.facts)
				.filter((name) => !state.looked.includes(name))
				.map((name) => ({ key: name, text: `Look up ${name}`, arg: name })),
		transition: (state, name) => ({
			...state,
			looked: [...state.looked, name],
			found: [...state.found, facts.facts[name] ?? ""],
		}),
	});

/** The toy domain's own stop: always offered, last, and kept when the choices are cut. */
export const stopLooking = choiceType<FactsState, null>({
	type: "stop",
	choices: () => [{ key: "stop", text: "Stop looking", arg: null, priority: -1 }],
	transition: (state) => ({ ...state, stopped: true }),
});

export const FACTS: DomainShared = { name: "facts", version: "1.0.0", limits: { steps: 8, windowShare: 0.9 } };

/** One yes-or-no question per fact, by the fact's name. */
const factQuestions = (facts: Facts): Questions =>
	Object.fromEntries(
		Object.keys(facts.facts).map((name) => [
			name,
			{ type: "bool", instructions: `Is ${name} true?`, criteria: { true: "yes", false: "no" } },
		]),
	);

/** The probability of true of each bool answer. */
const probabilities = (answers: Answers): Record<string, number> =>
	Object.fromEntries(
		Object.entries(answers).flatMap(([id, answer]) => (answer.type === "bool" ? [[id, answer.probability]] : [])),
	);

/**
 * The toy domain's state machine for `facts`, starting from `initial`: a pick in each state, from the facts not looked
 * up and stop; after stop, one step with a question for each fact.
 */
export function factsMachine(facts: Facts, initial: FactsState = START): StateMachine<FactsState> {
	const pick = picking({
		instructions: "Pick the next fact to look up.",
		limit: 30,
		...joinTypes(lookUp(facts), stopLooking),
	});
	return {
		initial: () => Promise.resolve(initial),
		questions: (state) => {
			if (state.answers !== null) return {};
			return state.stopped ? factQuestions(facts) : pick.questions(state);
		},
		transition: (state, answers) => {
			if (state.stopped) return Promise.resolve({ ...state, answers: probabilities(answers) });
			return pick.transition(state, answers);
		},
		view: (state, tokens) => Promise.resolve({ decisionState: { tokens, seen: [...state.found] } }),
	};
}

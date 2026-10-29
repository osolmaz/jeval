import { describe, expect, it } from "vitest";
import {
	batches,
	choiceType,
	definitionFor,
	type DomainShared,
	estimateTokens,
	joinTypes,
	type JsonObject,
	PICK_ID,
	picking,
	type Question,
	run,
	type StateMachine,
	Trace,
} from "../../src/core/index.ts";
import {
	answered,
	answering,
	type Facts,
	factsMachine,
	type FactsState,
	FACTS,
	failing,
	fakeDecider,
	PICK_TEXT,
	START,
	stopLooking,
} from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b" } };
const three: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };
const firstChoice = (labels: string[]) => labels[0] ?? "o1";
/** Looks up the first fact, then stops, then answers every fact with `probability`. */
const lookOnce = (probability: number) => {
	let picks = 0;
	return answering(probability, (labels) => (picks++ === 0 ? firstChoice(labels) : (labels.at(-1) ?? "o1")));
};
const notesOf = (trace: Trace) => trace.entries.flatMap((entry) => (entry.type === "note" ? [entry.message] : []));

describe("run", () => {
	it("asks the questions of each state until the domain asks nothing more, and traces every step", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(lookOnce(0.8)));
		expect(result).toMatchObject({ steps: 3, ended: "done", error: null });
		expect(result.state).toEqual({ looked: ["a"], found: ["fact a"], stopped: true, answers: { a: 0.8, b: 0.8 } });
		expect(result.trace.entries.map((entry) => entry.type)).toEqual([
			"start",
			"state",
			...["questions", "answers", "state"],
			...["questions", "answers", "state"],
			...["questions", "answers", "state"],
			"ended",
		]);
		expect(result.trace.entries.at(-1)).toEqual({ type: "ended", ended: "done", steps: 3, error: null });
		// The trace keeps no usage and no ids: the requests file keeps every request's usage once.
		expect(JSON.stringify(result.trace.entries)).not.toMatch(/"usage"|"parent"|"id"/);
	});

	it("starts the trace with what ran: the domain, its definition's hash, the case, the model and the limits", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(lookOnce(0.5)), { case: "c1" });
		expect(result.trace.entries[0]).toEqual({
			type: "start",
			domain: "facts",
			version: "1.0.0",
			definition: definitionFor(FACTS).hash,
			case: "c1",
			model: "fake/decider",
			limits: FACTS.limits,
		});
		const unnamed = await run(FACTS, factsMachine(facts), fakeDecider(lookOnce(0.5)));
		expect(unnamed.trace.entries[0]).toMatchObject({ case: null });
	});

	it("saves every state, the initial one at step 0", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(lookOnce(0.5)));
		const states = result.trace.entries.flatMap((entry) => (entry.type === "state" ? [entry.step] : []));
		expect(states).toEqual([0, 1, 2, 3]);
		expect(result.trace.entries[1]).toEqual({ type: "state", step: 0, state: START });
	});

	it("keeps the answers of each step under their question ids, in the order of the questions", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(lookOnce(0.7)));
		const answers = result.trace.entries.flatMap((entry) => (entry.type === "answers" ? [entry] : []));
		expect(answers.map((entry) => [entry.step, Object.keys(entry.answers)])).toEqual([
			[1, [PICK_ID]],
			[2, [PICK_ID]],
			[3, ["a", "b"]],
		]);
		expect(answers[0]?.answers[PICK_ID]).toEqual({
			type: "choice",
			choice: "o1",
			probabilities: { o1: 0.9 },
			confidence: 0.8,
		});
		expect(answers.some((entry) => entry.repeated === true)).toBe(false);
	});

	it("keeps switch's facts about a pick in the trace, and sends the model its question without them", async () => {
		const decider = fakeDecider(lookOnce(0.5));
		const result = await run(FACTS, factsMachine(facts), decider);
		const asked = result.trace.entries.find((entry) => entry.type === "questions");
		expect(asked?.type === "questions" ? asked.questions[PICK_ID]?.data : undefined).toEqual({
			choices: {
				o1: { key: "look-up:a", type: "look-up" },
				o2: { key: "look-up:b", type: "look-up" },
				o3: { key: "stop:stop", type: "stop" },
			},
		});
		expect(decider.requests[0]?.decisionQuestions[PICK_ID]).toEqual({
			type: "choice",
			instructions: PICK_TEXT,
			criteria: { o1: "Look up a", o2: "Look up b", o3: "Stop looking" },
		});
	});

	it("ends with no steps when the domain asks nothing in the initial state", async () => {
		const done: StateMachine<FactsState> = { ...factsMachine(facts), questions: () => ({}) };
		const decider = fakeDecider(lookOnce(0.5));
		const result = await run(FACTS, done, decider);
		expect(result).toMatchObject({ steps: 0, ended: "done", error: null, state: START });
		expect(decider.requests).toEqual([]);
	});

	it("starts from the initial state and writes entries to the sink", async () => {
		const seen: string[] = [];
		const decider = fakeDecider(answering(0.5));
		const opened = { ...START, looked: ["x"], found: ["opened"] };
		await run(FACTS, factsMachine(facts, opened), decider, { trace: new Trace((entry) => seen.push(entry.type)) });
		expect(seen.slice(0, 2)).toEqual(["start", "state"]);
		expect(decider.requests[0]?.decisionState["seen"]).toEqual(["opened"]);
	});
});

/** A counter that asks forever: each step adds the picked amount. */
interface Count extends JsonObject {
	readonly n: number;
}
const add = (by: number) => ({ type: "add", key: `add-${String(by)}`, text: `Add ${String(by)}`, by });
const endless: StateMachine<Count> = {
	initial: () => Promise.resolve({ n: 0 }),
	...picking({
		instructions: "Add one or two.",
		limit: 10,
		choices: () => [add(1), add(2)],
		transition: (state, choice) => Promise.resolve({ n: state.n + choice.by }),
	}),
};

describe("the step limit", () => {
	it("ends a run at the step limit that the domain sets, with nothing more asked", async () => {
		const decider = fakeDecider(answering(0.5));
		const result = await run({ ...FACTS, limits: { steps: 3, windowShare: 0.9 } }, endless, decider);
		expect(result).toMatchObject({ steps: 3, ended: "step limit", error: null, state: { n: 6 } });
		expect(decider.requests.length).toBe(3);
	});

	it("is none by default, so the domain decides when its run ends", async () => {
		const counted: StateMachine<Count> = {
			...endless,
			questions: (state) => (state.n >= 40 ? {} : endless.questions(state)),
		};
		const result = await run({ ...FACTS, limits: { windowShare: 0.9 } }, counted, fakeDecider(answering(0.5)));
		expect(result).toMatchObject({ steps: 20, ended: "done", state: { n: 40 } });
		expect(result.trace.entries[0]).toMatchObject({ limits: { windowShare: 0.9 } });
	});
});

describe("a failed step", () => {
	const failedWith = async (policy: Parameters<typeof fakeDecider>[0], machine = factsMachine(facts)) =>
		run(FACTS, machine, fakeDecider(policy));

	it("ends the run when a request fails, and says why in the result and at the end of the trace", async () => {
		const result = await failedWith(() => failing("the provider is down"));
		expect(result).toMatchObject({ steps: 1, ended: "failed", error: "the provider is down", state: START });
		expect(result.trace.entries.at(-1)).toEqual({
			type: "ended",
			ended: "failed",
			steps: 1,
			error: "the provider is down",
		});
		expect(result.trace.entries.some((entry) => entry.type === "answers")).toBe(false);
	});

	it("ends the run when the model leaves a question unanswered or answers it outside the question", async () => {
		expect((await failedWith(() => answered({}))).error).toBe("no answer to pick");
		const outside = (choice: string) =>
			failedWith(() => answered({ [PICK_ID]: { type: "choice", choice, probabilities: {}, confidence: 1 } }));
		expect((await outside("o9")).error).toBe("the model answered o9 to pick, which is none of its labels");
		// A name that every object has is no label either.
		expect((await outside("toString")).error).toBe(
			"the model answered toString to pick, which is none of its labels",
		);
		const wrongType = await failedWith(() => answered({ [PICK_ID]: { type: "bool", probability: 1 } }));
		expect(wrongType.error).toBe("the answer to pick is a bool answer, not a choice one");
	});

	it("ends the run at the step whose answers fail, after the steps before it", async () => {
		const partial = fakeDecider((request, call) =>
			PICK_ID in request.decisionQuestions
				? answering(0.5, (labels) => labels.at(-1) ?? "o1")(request, call)
				: answered({ a: { type: "bool", probability: 1 } }),
		);
		const result = await run(FACTS, factsMachine(facts), partial);
		expect(result).toMatchObject({ steps: 2, ended: "failed", error: "no answer to b" });
		expect(result.state).toMatchObject({ stopped: true, answers: null });
	});
});

describe("the view", () => {
	it("sends a smaller view when the request was too long, up to three requests in all", async () => {
		const decider = fakeDecider(
			(request, call) => (call === 1 ? failing("max_tokens_exceeded", true) : answering(0.6)(request, call)),
			120,
		);
		const result = await run(FACTS, factsMachine(facts), decider);
		expect(result.ended).toBe("done");
		const rooms = decider.requests.map((request) => request.decisionState["tokens"]);
		expect(Number(rooms[1])).toBeLessThan(Number(rooms[0]));
		expect(
			notesOf(result.trace).some((note) =>
				/^the request did not fit the model's window; trying a view of \d+ tokens$/.test(note),
			),
		).toBe(true);
		const tooLong = fakeDecider(() => failing("too long", true));
		const given = await run(FACTS, factsMachine(facts), tooLong);
		expect(given).toMatchObject({ steps: 1, ended: "failed", error: "too long" });
		expect(tooLong.requests.length).toBe(3);
	});

	it("gets the window's share less the questions' size, and the decider's characters per token", async () => {
		const asked: number[] = [];
		const counting: StateMachine<FactsState> = {
			...factsMachine(facts),
			view: (state, tokens, charsPerToken) => {
				asked.push(charsPerToken);
				return Promise.resolve({ decisionState: { tokens } });
			},
		};
		const decider = fakeDecider(lookOnce(0.5));
		await run(FACTS, counting, decider);
		const room = (index: number) => Number(decider.requests[index]?.decisionState["tokens"]);
		const questions = (index: number) => decider.requests[index]?.decisionQuestions;
		for (const index of [0, 2]) {
			expect(room(index)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(questions(index), 3));
		}
		expect(asked).toEqual([3, 3, 3]);
	});

	it("is the state as it is when the domain gives no view function, and is sent once when it is too long", async () => {
		const decider = fakeDecider(answering(0.5));
		const counted: StateMachine<Count> = {
			...endless,
			questions: (state) => (state.n >= 4 ? {} : endless.questions(state)),
		};
		const result = await run(FACTS, counted, decider);
		expect(decider.requests.map((request) => request.decisionState)).toEqual([{ n: 0 }, { n: 2 }]);
		expect(decider.requests.every((request) => request.decisionImages === undefined)).toBe(true);
		expect(result).toMatchObject({ state: { n: 4 }, ended: "done" });
		const tooLong = fakeDecider(() => failing("too long", true));
		const once = await run(FACTS, endless, tooLong);
		expect(once).toMatchObject({ ended: "failed", error: "too long" });
		expect(tooLong.requests.length).toBe(1);
		expect(notesOf(once.trace).some((note) => note.startsWith("the request did not fit"))).toBe(false);
	});
});

describe("many questions", () => {
	const question: Question = { type: "bool", instructions: "x".repeat(30), criteria: { true: "y", false: "n" } };

	it("go into batches by id under the size limit, and a large question gets its own batch", () => {
		const size = estimateTokens({ a: question }, 3);
		const all = { a: question, b: question, c: question };
		expect(batches(all, size * 2, 3).map((group) => Object.keys(group))).toEqual([["a", "b"], ["c"]]);
		expect(batches({ a: question, b: question }, 1, 3).map((group) => Object.keys(group))).toEqual([["a"], ["b"]]);
	});

	it("of a step are split into batches that fit the window, and their answers joined", async () => {
		const decider = fakeDecider(answering(0.5), 200);
		const result = await run(FACTS, factsMachine(three), decider);
		const batched = decider.requests.filter((request) => !(PICK_ID in request.decisionQuestions));
		expect(batched.map((request) => Object.keys(request.decisionQuestions))).toEqual([["a", "b"], ["c"]]);
		expect(result.state.answers).toEqual({ a: 0.5, b: 0.5, c: 0.5 });
	});
});

describe("a pick", () => {
	it("shows at most its limit of choices, keeps the domain's stop by its priority, and says how many were cut", async () => {
		const decider = fakeDecider(answering(0.5));
		const result = await run(FACTS, factsMachine(three, START, 2), decider);
		expect(decider.requests[0]?.decisionQuestions[PICK_ID]).toMatchObject({
			criteria: { o1: "Look up a", o2: "Stop looking" },
		});
		const asked = result.trace.entries.find((entry) => entry.type === "questions");
		expect(asked?.type === "questions" ? asked.questions[PICK_ID]?.data : undefined).toMatchObject({ cut: 2 });
	});

	it("keeps each choice's own facts with its label", async () => {
		const tagged = choiceType<FactsState, string>({
			type: "tag",
			choices: (state) =>
				state.looked.length > 0 ? [] : [{ key: "a", text: "Tag a", arg: "a", data: { name: "a" } }],
			transition: (state, name) => ({ ...state, looked: [name], found: ["tagged"] }),
		});
		const machine: StateMachine<FactsState> = {
			...factsMachine(facts),
			...picking({ instructions: PICK_TEXT, limit: 5, ...joinTypes(tagged, stopLooking) }),
		};
		const result = await run(FACTS, machine, fakeDecider(answering(0.5, firstChoice)));
		const asked = result.trace.entries.find((entry) => entry.type === "questions");
		expect(asked?.type === "questions" ? asked.questions[PICK_ID]?.data : undefined).toEqual({
			choices: { o1: { key: "tag:a", type: "tag", data: { name: "a" } }, o2: { key: "stop:stop", type: "stop" } },
		});
		expect(result.state).toMatchObject({ looked: ["a"], found: ["tagged"] });
	});
});

describe("a domain's own shared parts", () => {
	it("need only a name, a version and limits", async () => {
		const bare: DomainShared = { name: "bare", version: "0", limits: { steps: 2, windowShare: 0.5 } };
		const result = await run(bare, endless, fakeDecider(answering(0.5)), { case: "x" });
		expect(result.trace.entries[0]).toMatchObject({ domain: "bare", definition: definitionFor(bare).hash });
	});
});

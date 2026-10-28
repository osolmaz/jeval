import { describe, expect, it } from "vitest";
import {
	batches,
	type Choice,
	estimateTokens,
	type JsonObject,
	parseTrace,
	PICK_ID,
	type Question,
	run,
	type StateMachine,
	STOP_KEY,
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
} from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b" } };
const firstChoice = (labels: string[]) => labels[0] ?? STOP_KEY;
const one = { limits: { steps: 1, choices: 30, windowShare: 0.9 } };
const notesOf = (trace: Trace) => trace.entries.flatMap((entry) => (entry.type === "note" ? [entry.message] : []));

describe("run", () => {
	it("takes steps until the model stops, answers every question, and ends the trace with how the steps ended", async () => {
		let calls = 0;
		const decider = fakeDecider(answering(0.8, (labels) => (calls++ === 0 ? firstChoice(labels) : STOP_KEY)));
		const result = await run(FACTS, factsMachine(facts), decider);
		expect(result).toMatchObject({ steps: 2, ended: "stop", error: null });
		expect(result.answers).toEqual({ a: { type: "bool", probability: 0.8 }, b: { type: "bool", probability: 0.8 } });
		expect(result.state).toEqual({ looked: ["a"], found: ["fact a"] });
		expect(result.trace.entries.map((entry) => entry.type)).toEqual([
			"start",
			"state",
			"choices",
			"pick",
			"state",
			"choices",
			"pick",
			"answers",
			"end",
		]);
		expect(result.trace.entries.at(-1)).toEqual({ type: "end", ended: "stop", error: null });
		// The trace keeps no usage and no ids: the requests file keeps every request's usage once.
		expect(JSON.stringify(result.trace.entries)).not.toMatch(/"usage"|"parent"|"id"/);
	});

	it("saves every state, the initial one at step 0", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)));
		const states = result.trace.entries.flatMap((entry) =>
			entry.type === "state" ? [[entry.step, entry.state]] : [],
		);
		expect(states).toEqual([
			[0, { looked: [], found: [] }],
			[1, { looked: ["a"], found: ["fact a"] }],
			[2, { looked: ["a", "b"], found: ["fact a", "fact b"] }],
		]);
		expect(result.ended).toBe("no choices");
	});

	it("records each pick as the choice answer: the picked key, the probabilities by key, and the confidence", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)), one);
		expect(result.trace.entries.find((entry) => entry.type === "pick")).toEqual({
			type: "pick",
			step: 1,
			choice: "look-up:a",
			probabilities: { "look-up:a": 0.9 },
			confidence: 0.8,
		});
	});

	it("stops when a state has no choices or the step limit is reached", async () => {
		const empty = await run(FACTS, factsMachine({ facts: {} }), fakeDecider(answering(0.5, firstChoice)));
		expect(empty).toMatchObject({ steps: 0, ended: "no choices" });
		const limited = await run(
			FACTS,
			factsMachine({ facts: { a: "1", b: "2", c: "3" } }),
			fakeDecider(answering(0.5, firstChoice)),
			{ limits: { steps: 2, choices: 30, windowShare: 0.9 } },
		);
		expect(limited).toMatchObject({ steps: 2, ended: "step limit" });
	});

	it("goes on to the answers when a pick fails, gives no pick, or names no label", async () => {
		const failed = await run(
			FACTS,
			factsMachine(facts),
			fakeDecider((request, call) => (call === 1 ? failing("down") : answering(0.9)(request, call))),
		);
		expect(failed).toMatchObject({ ended: "pick failed", error: null });
		expect(failed.answers).not.toBeNull();
		expect(notesOf(failed.trace)).toContain("the pick failed: down; the case goes on to its answers");
		const silent = await run(
			FACTS,
			factsMachine(facts),
			fakeDecider((request, call) => (call === 1 ? answered({}) : answering(0.9)(request, call))),
		);
		expect(silent.ended).toBe("pick failed");
		expect(notesOf(silent.trace)).toContain(
			"the pick failed: the model gave no answer; the case goes on to its answers",
		);
		const lost = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.9, () => "o9")));
		expect(lost).toMatchObject({ steps: 1, ended: "pick failed" });
		expect(notesOf(lost.trace)).toContain("the pick failed: the model picked o9, which is none of the labels");
		expect(lost.trace.entries.some((entry) => entry.type === "pick")).toBe(false);
	});

	it("sends a smaller view when the request was too long, up to three requests in all", async () => {
		const decider = fakeDecider(
			(request, call) =>
				call === 1 ? failing("max_tokens_exceeded", true) : answering(0.6, () => STOP_KEY)(request, call),
			120,
		);
		const result = await run(FACTS, factsMachine(facts), decider);
		expect(result.answers).not.toBeNull();
		const rooms = decider.requests.map((request) => request.decisionState["tokens"]);
		expect(Number(rooms[1])).toBeLessThan(Number(rooms[0]));
		expect(
			notesOf(result.trace).some((note) =>
				/^the request did not fit the model's window; trying a view of \d+ tokens$/.test(note),
			),
		).toBe(true);
		const tooLong = fakeDecider(() => failing("too long", true));
		const given = await run(FACTS, factsMachine(facts), tooLong);
		expect(given).toMatchObject({ answers: null, error: "too long", ended: "pick failed" });
		expect(tooLong.requests.length).toBe(6);
		expect(given.trace.entries.at(-1)).toEqual({ type: "end", ended: "pick failed", error: "too long" });
	});

	it("reports every question the model did not answer", async () => {
		const partial = fakeDecider((request) =>
			PICK_ID in request.decisionQuestions
				? answering(0.5, () => STOP_KEY)(request, 0)
				: answered({ a: { type: "bool", probability: 1 } }),
		);
		expect((await run(FACTS, factsMachine(facts), partial)).error).toBe("no answer for b");
		const silent = fakeDecider((request) =>
			PICK_ID in request.decisionQuestions ? answering(0.5, () => STOP_KEY)(request, 0) : answered({}),
		);
		expect((await run(FACTS, factsMachine(facts), silent)).error).toBe("no answer for a, b");
	});

	it("refuses a domain question with the pick question's id", async () => {
		const clash: StateMachine<FactsState> = {
			...factsMachine(facts),
			questions: () => ({ [PICK_ID]: { type: "bool", instructions: "x", criteria: { true: "y", false: "n" } } }),
		};
		await expect(run(FACTS, clash, fakeDecider(answering(0.5, () => STOP_KEY)))).rejects.toThrow(
			"a question cannot have the id pick",
		);
	});

	it("starts from the initial state and writes entries to the sink", async () => {
		const seen: string[] = [];
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(FACTS, factsMachine(facts, { looked: ["x"], found: ["opened"] }), decider, {
			trace: new Trace((entry) => seen.push(entry.type)),
		});
		expect(seen.slice(0, 2)).toEqual(["start", "state"]);
		expect(decider.requests[0]?.decisionState["seen"]).toEqual(["opened"]);
	});
});

describe("a domain with only the three functions", () => {
	/** A counter: its choices add one or two, until it reaches three. */
	interface Count extends JsonObject {
		readonly n: number;
	}
	const counter: StateMachine<Count, Choice & { readonly by: number }> = {
		initial: () => Promise.resolve({ n: 0 }),
		choices: (state) =>
			state.n >= 3
				? []
				: [1, 2].map((by) => ({
						type: "add",
						key: `${String(state.n)}+${String(by)}`,
						text: `Add ${String(by)}`,
						by,
					})),
		transition: (state, choice) => Promise.resolve({ n: state.n + choice.by }),
	};

	it("runs: the model reads the state as it is, and the run asks no questions", async () => {
		const decider = fakeDecider(answering(0.5, (labels) => labels.at(-2) ?? STOP_KEY));
		const result = await run(FACTS, counter, decider);
		expect(decider.requests.map((request) => request.decisionState)).toEqual([{ n: 0 }, { n: 2 }]);
		expect(decider.requests.every((request) => request.decisionImages.length === 0)).toBe(true);
		expect(result).toMatchObject({ state: { n: 4 }, ended: "no choices", answers: {} });
		expect(result.trace.entries.at(-2)).toEqual({ type: "answers", answers: {} });
	});
});

describe("batches", () => {
	const question: Question = { type: "bool", instructions: "x".repeat(30), criteria: { true: "y", false: "n" } };

	it("groups questions by id under the size limit and gives a large question its own group", () => {
		const size = estimateTokens({ a: question }, 3);
		const all = { a: question, b: question, c: question };
		expect(batches(all, size * 2, 3).map((group) => Object.keys(group))).toEqual([["a", "b"], ["c"]]);
		expect(batches({ a: question, b: question }, 1, 3).map((group) => Object.keys(group))).toEqual([["a"], ["b"]]);
	});
});

describe("run, in detail", () => {
	const three: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };

	it("asks the pick as one choice question, labelled o1, o2…, with one place for stop", async () => {
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(FACTS, factsMachine(three), decider, { limits: { steps: 8, choices: 2, windowShare: 0.9 } });
		expect(decider.requests[0]?.decisionQuestions).toEqual({
			[PICK_ID]: {
				type: "choice",
				instructions: FACTS.instructions,
				criteria: { o1: "Look up a", stop: "Stop" },
			},
		});
		expect(decider.requests[0]?.decisionState["purpose"]).toBe("pick");
	});

	it("gives the view the window's share less the questions' size, and the decider's characters per token", async () => {
		const asked: number[] = [];
		const counting: StateMachine<FactsState> = {
			...factsMachine(facts),
			view: (state, purpose, tokens, charsPerToken) => {
				asked.push(charsPerToken);
				return Promise.resolve({ decisionState: { purpose, tokens }, decisionImages: [] });
			},
		};
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(FACTS, counting, decider);
		const [pick, answers] = decider.requests;
		const room = (request: typeof pick) => Number(request?.decisionState["tokens"]);
		expect(room(pick)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(pick?.decisionQuestions, 3));
		expect(room(answers)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(answers?.decisionQuestions, 3));
		expect(asked).toEqual([3, 3]);
	});

	it("splits the answers into batches that fit the window", async () => {
		const decider = fakeDecider(
			answering(0.5, () => STOP_KEY),
			200,
		);
		const result = await run(FACTS, factsMachine(three), decider);
		const answerRequests = decider.requests.filter((request) => !(PICK_ID in request.decisionQuestions));
		expect(answerRequests.map((request) => Object.keys(request.decisionQuestions))).toEqual([["a", "b"], ["c"]]);
		expect(result.trace.entries.some((entry) => entry.type === "stage")).toBe(false);
	});

	it("traces each stage of a domain's own answers over the stage's own view, then the final answers", async () => {
		const staged: StateMachine<FactsState> = {
			...factsMachine(facts),
			answer: async ({ state, questions, ask }) => {
				const view = (tokens: number) =>
					Promise.resolve({ decisionState: { seen: [...state.found], tokens }, decisionImages: [] });
				const found = await ask(questions, { stage: "check", view });
				const none = { type: "bool", probability: 0 } as const;
				return Object.fromEntries(Object.keys(questions).map((id) => [id, found[id] ?? none]));
			},
		};
		const decider = fakeDecider(answering(0.3, () => STOP_KEY));
		const result = await run(FACTS, staged, decider);
		expect(result.trace.entries.slice(-3).map((entry) => entry.type)).toEqual(["stage", "answers", "end"]);
		expect(result.trace.entries.at(-3)).toMatchObject({ stage: "check" });
		expect(decider.requests.at(-1)?.decisionState["seen"]).toEqual([]);
	});
});

describe("data for tools", () => {
	const tagged: StateMachine<FactsState> = {
		...factsMachine(facts),
		choices: (state) =>
			Object.keys(facts.facts)
				.filter((name) => !state.looked.includes(name))
				.map((name) => ({ type: "tag", key: `tag:${name}`, text: `Tag ${name}`, data: { name } })),
		transition: (state, choice) =>
			Promise.resolve({ looked: [...state.looked, choice.key.slice(4)], found: [...state.found, "tagged"] }),
	};

	it("keeps the choices' data in the trace", async () => {
		const result = await run(FACTS, tagged, fakeDecider(answering(0.5, firstChoice)), one);
		const lines = result.trace.entries.map((entry) => JSON.stringify(entry)).join("\n");
		const entries = parseTrace(lines);
		const offered = entries.find((entry) => entry.type === "choices");
		expect(offered?.type === "choices" ? offered.choices.map((choice) => [choice.type, choice.data]) : []).toEqual([
			["tag", { name: "a" }],
			["tag", { name: "b" }],
			["stop", undefined],
		]);
		expect(result.state).toEqual({ looked: ["a"], found: ["tagged"] });
	});

	it("writes no data field when a choice has none", async () => {
		const result = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)), one);
		const lines = result.trace.entries.map((entry) => JSON.stringify(entry));
		expect(lines.some((line) => line.includes('"data"'))).toBe(false);
	});
});

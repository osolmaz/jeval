import { describe, expect, it } from "vitest";
import {
	batches,
	type Choice,
	estimateTokens,
	type JsonObject,
	parseTrace,
	type Question,
	run,
	type StateMachine,
	STOP_KEY,
	Trace,
} from "../../src/core/index.ts";
import {
	answering,
	type Facts,
	factsMachine,
	type FactsState,
	factsTexts,
	failing,
	fakeDecider,
} from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b" } };
const firstChoice = (labels: string[]) => labels[0] ?? STOP_KEY;
const one = { limits: { steps: 1, choices: 30, windowShare: 0.9 } };

describe("run", () => {
	it("takes steps until the model stops, then answers every question", async () => {
		let calls = 0;
		const decider = fakeDecider(answering(0.8, (labels) => (calls++ === 0 ? firstChoice(labels) : STOP_KEY)));
		const result = await run(factsTexts, factsMachine(facts), decider);
		expect(result.steps).toBe(2);
		expect(result.ended).toBe("stop");
		expect(result.error).toBeNull();
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
		]);
		expect(result.trace.entries[0]).not.toHaveProperty("case");
		expect(result.trace.entries.at(-1)?.parent).toBe(result.trace.entries.at(-2)?.id);
	});

	it("saves every state, the initial one at step 0", async () => {
		const result = await run(factsTexts, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)));
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

	it("records each pick's probability under its key", async () => {
		const result = await run(factsTexts, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)), one);
		const pick = result.trace.entries.find((entry) => entry.type === "pick");
		expect(pick).toMatchObject({ key: "look-up:a", probabilities: { "look-up:a": 0.9 } });
		expect(pick).not.toHaveProperty("confidence");
	});

	it("records the model's confidence in its pick when the model gives one", async () => {
		const sure = fakeDecider((request, call) => {
			const result = answering(0.5, firstChoice)(request, call);
			if (!result.ok || request.questions[0]?.type !== "choice") return result;
			const answer = result.answers["next"];
			return answer?.type === "choice" ? { ...result, answers: { next: { ...answer, confidence: 0.7 } } } : result;
		});
		const result = await run(factsTexts, factsMachine(facts), sure, one);
		expect(result.trace.entries.find((entry) => entry.type === "pick")).toMatchObject({ confidence: 0.7 });
	});

	it("stops when a state has no choices or the step limit is reached", async () => {
		const empty = await run(factsTexts, factsMachine({ facts: {} }), fakeDecider(answering(0.5, firstChoice)));
		expect(empty).toMatchObject({ steps: 0, ended: "no choices" });
		const limited = await run(
			factsTexts,
			factsMachine({ facts: { a: "1", b: "2", c: "3" } }),
			fakeDecider(answering(0.5, firstChoice)),
			{ limits: { steps: 2, choices: 30, windowShare: 0.9 } },
		);
		expect(limited).toMatchObject({ steps: 2, ended: "step limit" });
	});

	it("goes on to the answers when a pick fails or names no choice", async () => {
		const failed = await run(
			factsTexts,
			factsMachine(facts),
			fakeDecider((request, call) => (call === 1 ? failing("provider") : answering(0.9)(request, call))),
		);
		expect(failed.answers).not.toBeNull();
		expect(failed.ended).toBe("pick failed");
		expect(failed.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("pick failed"))).toBe(
			true,
		);
		const silent = await run(
			factsTexts,
			factsMachine(facts),
			fakeDecider((request, call) =>
				call === 1
					? { ok: true, answers: {}, usage: { inputTokens: null, milliseconds: 0 } }
					: answering(0.9)(request, call),
			),
		);
		expect(silent.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("no pick"))).toBe(
			true,
		);
		expect(silent.ended).toBe("pick failed");
	});

	it("sends a smaller view when the model reports the window was exceeded, and notes what the view left out", async () => {
		const decider = fakeDecider(
			(request, call) =>
				call === 1 ? failing("window", "max_tokens_exceeded") : answering(0.6, () => STOP_KEY)(request, call),
			120,
		);
		const result = await run(factsTexts, factsMachine(facts), decider);
		expect(result.answers).not.toBeNull();
		const rooms = decider.requests.map((request) => request.json["tokens"]);
		expect(Number(rooms[1])).toBeLessThan(Number(rooms[0]));
		expect(
			result.trace.entries.some((entry) => entry.type === "note" && entry.message.startsWith("the view left out")),
		).toBe(true);
	});

	it("gives up on the answers after three window failures", async () => {
		const result = await run(
			factsTexts,
			factsMachine(facts),
			fakeDecider(() => failing("window")),
		);
		expect(result.answers).toBeNull();
		expect(result.error).toBe("window: failed");
	});

	it("reports a question the model did not answer", async () => {
		const partial = fakeDecider((request) =>
			request.questions[0]?.type === "choice"
				? answering(0.5, () => STOP_KEY)(request, 0)
				: {
						ok: true,
						answers: { a: { type: "bool", probability: 1 } },
						usage: { inputTokens: 1, milliseconds: 1 },
					},
		);
		const result = await run(factsTexts, factsMachine(facts), partial);
		expect(result.error).toBe("no answer for b");
	});

	it("starts from the initial state and writes entries to the sink", async () => {
		const seen: string[] = [];
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(factsTexts, factsMachine(facts, { looked: ["x"], found: ["opened"] }), decider, {
			trace: new Trace((entry) => seen.push(entry.type)),
		});
		expect(seen.slice(0, 2)).toEqual(["start", "state"]);
		expect(decider.requests[0]?.json["seen"]).toEqual(["opened"]);
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
		const result = await run(factsTexts, counter, decider);
		expect(decider.requests.map((request) => request.json)).toEqual([{ n: 0 }, { n: 2 }]);
		expect(decider.requests.every((request) => request.images.length === 0)).toBe(true);
		expect(result).toMatchObject({ state: { n: 4 }, ended: "no choices", answers: {} });
		expect(result.trace.entries.at(-1)).toMatchObject({ type: "answers", answers: {}, usage: [] });
	});
});

describe("batches", () => {
	const question = (id: string): Question => ({ type: "bool", id, instructions: "x".repeat(30), yes: "y", no: "n" });

	it("groups questions under the size limit and gives a large question its own group", () => {
		const size = estimateTokens(question("a"), 3);
		expect(batches([question("a"), question("b"), question("c")], size * 2, 3).map((group) => group.length)).toEqual([
			2, 1,
		]);
		expect(batches([question("a"), question("b")], 1, 3).map((group) => group.length)).toEqual([1, 1]);
	});
});

describe("run, in detail", () => {
	const three: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };

	it("labels the choices o1, o2… and keeps one place for stop", async () => {
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(factsTexts, factsMachine(three), decider, { limits: { steps: 8, choices: 2, windowShare: 0.9 } });
		const question = decider.requests[0]?.questions[0];
		expect(question?.type === "choice" ? question.choices : null).toEqual({ o1: "Look up a", stop: "Stop" });
	});

	it("gives the view the window's share less the questions' size", async () => {
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(factsTexts, factsMachine(facts), decider);
		const [pick, answers] = decider.requests;
		const room = (request: typeof pick) => Number(request?.json["tokens"]);
		expect(room(pick)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(pick?.questions, 3));
		expect(room(answers)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(answers?.questions, 3));
	});

	it("splits the answers into batches that fit the window, and keeps every batch's usage", async () => {
		const decider = fakeDecider(
			answering(0.5, () => STOP_KEY),
			200,
		);
		const result = await run(factsTexts, factsMachine(three), decider);
		const answerRequests = decider.requests.filter((request) => request.questions[0]?.type === "bool");
		expect(answerRequests.length).toBe(2);
		expect(result.trace.entries.find((entry) => entry.type === "answers")).toMatchObject({ usage: [{}, {}] });
		expect(result.trace.entries.some((entry) => entry.type === "stage")).toBe(false);
	});

	it("names every unanswered question, and notes each retry and what the view left out", async () => {
		const silent = fakeDecider((request) =>
			request.questions[0]?.type === "choice"
				? answering(0.5, () => STOP_KEY)(request, 0)
				: { ok: true, answers: {}, usage: { inputTokens: 1, milliseconds: 1 } },
		);
		expect((await run(factsTexts, factsMachine(facts), silent)).error).toBe("no answer for a, b");
		const tight = fakeDecider(
			(request, call) => (call === 1 ? failing("window") : answering(0.5, () => STOP_KEY)(request, call)),
			120,
		);
		const notes = (await run(factsTexts, factsMachine(facts), tight)).trace.entries.flatMap((entry) =>
			entry.type === "note" ? [entry.message] : [],
		);
		expect(notes).toContain("the view left out: everything; the rest");
		expect(
			notes.some((note) => /^the request did not fit the model's window; trying a view of \d+ tokens$/.test(note)),
		).toBe(true);
	});

	it("traces each stage of a domain's own answers, then the final answers", async () => {
		const staged: StateMachine<FactsState> = {
			...factsMachine(facts),
			answer: async ({ state, questions, ask }) => {
				const found = await ask(questions, { stage: "check", json: { seen: [...state.found] } });
				const none = { type: "bool", probability: 0 } as const;
				return Object.fromEntries(questions.map((question) => [question.id, found[question.id] ?? none]));
			},
		};
		const decider = fakeDecider(answering(0.3, () => STOP_KEY));
		const result = await run(factsTexts, staged, decider);
		expect(result.trace.entries.slice(-2).map((entry) => entry.type)).toEqual(["stage", "answers"]);
		expect(result.trace.entries.at(-2)).toMatchObject({ stage: "check" });
		expect(decider.requests.at(-1)?.json).toEqual({ seen: [] });
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
		const result = await run(factsTexts, tagged, fakeDecider(answering(0.5, firstChoice)), one);
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
		const result = await run(factsTexts, factsMachine(facts), fakeDecider(answering(0.5, firstChoice)), one);
		const lines = result.trace.entries.map((entry) => JSON.stringify(entry));
		expect(lines.some((line) => line.includes('"data"'))).toBe(false);
	});
});

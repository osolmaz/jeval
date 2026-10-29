import { describe, expect, it } from "vitest";
import {
	parseTrace,
	PICK_ID,
	recordedModel,
	ReplayError,
	replayOf,
	run,
	type StateMachine,
	startOf,
	Trace,
	type TraceEntry,
} from "../../src/core/index.ts";
import {
	answering,
	type Facts,
	factsMachine,
	type FactsState,
	FACTS,
	failing,
	fakeDecider,
	type Policy,
} from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };

/** The same facts with a transition that fails: a replay that ran a transition again would fail. */
const unrunnable: StateMachine<FactsState> = {
	...factsMachine(facts),
	initial: () => Promise.reject(new Error("the initial state was made again")),
	transition: () => Promise.reject(new Error("a transition ran again")),
};

/** A recorded run that picks the second choice twice, then stops and answers; `policy` overrides the decider. */
async function recorded(policy?: Policy): Promise<TraceEntry[]> {
	let calls = 0;
	const fallback = answering(0.7, (labels) => (calls++ < 2 ? (labels[1] ?? "o1") : (labels.at(-1) ?? "o1")));
	return (await run(FACTS, factsMachine(facts), fakeDecider(policy ?? fallback))).trace.entries;
}

const answersOf = (list: readonly TraceEntry[]) => list.filter((entry) => entry.type === "answers");
const states = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "state" ? [entry.state] : []));
/** Picks the first choice, then fails the second request. */
const failsSecond: Policy = (request, call) =>
	call === 2 ? failing("down") : answering(0.4, (labels) => labels[0] ?? "o1")(request, call);
const again = (list: readonly TraceEntry[], machine: StateMachine<FactsState> = unrunnable) =>
	run(FACTS, machine, recordedModel(list), { replay: replayOf(list) });

describe("a replay of a whole trace", () => {
	it("repeats the answers, the states and the ending, asks no model and runs no transition", async () => {
		const entries = await recorded();
		const result = await again(entries);
		expect(answersOf(result.trace.entries)).toEqual(
			answersOf(entries).map((entry) => ({ ...entry, repeated: true })),
		);
		expect(states(result.trace.entries)).toEqual(states(entries));
		expect(result).toMatchObject({ steps: 4, ended: "done", error: null });
		expect(result.state).toEqual({
			looked: ["b", "c"],
			found: ["fact b", "fact c"],
			stopped: true,
			answers: { a: 0.7, b: 0.7, c: 0.7 },
		});
	});

	it("takes the trace's limits, whatever the domain's are now", async () => {
		const entries = await recorded();
		const tighter = { ...FACTS, limits: { steps: 1, windowShare: 0.5 } };
		const result = await run(tighter, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(result).toMatchObject({ steps: 4, ended: "done" });
		expect(result.trace.entries[0]).toMatchObject({ limits: FACTS.limits });
	});

	it("fails where the recorded request failed, with the recorded error", async () => {
		const entries = await recorded(failsSecond);
		expect(entries.at(-1)).toEqual({ type: "ended", ended: "failed", steps: 2, error: "down" });
		const result = await again(entries);
		expect(result).toMatchObject({ steps: 2, ended: "failed", error: "down" });
		expect(result.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("failed here"))).toBe(
			true,
		);
	});
});

describe("a fork", () => {
	it("takes the state after some steps, then lets the model answer, and runs its transitions", async () => {
		const entries = await recorded();
		let calls = 0;
		const then = fakeDecider(
			answering(0.2, (labels) => (calls++ === 0 ? (labels[0] ?? "o1") : (labels.at(-1) ?? "o1"))),
		);
		const forked = await run(FACTS, factsMachine(facts), then, { replay: replayOf(entries, { fork: 1 }) });
		expect(forked).toMatchObject({ steps: 4, ended: "done" });
		expect(forked.state).toMatchObject({ looked: ["b", "a"], answers: { a: 0.2, b: 0.2, c: 0.2 } });
		expect(forked.trace.entries[0]).toMatchObject({ model: "fake/decider" });
		expect(() => replayOf(entries, { fork: 9 })).toThrow(
			"the trace has 4 steps that a fork can repeat, fewer than the fork's 9",
		);
	});

	it("repeats only the steps with answers and a state: not a failed request, nor a step whose transition failed", async () => {
		const failed = await recorded(failsSecond);
		expect(() => replayOf(failed, { fork: 2 })).toThrow("the trace has 1 steps that a fork can repeat");
		expect(replayOf(failed, { fork: 1 }).steps.length).toBe(1);
		const trace = new Trace();
		let transitions = 0;
		const breaks: StateMachine<FactsState> = {
			...factsMachine(facts),
			transition: (state, answers) =>
				++transitions === 2 ? Promise.reject(new Error("broken")) : factsMachine(facts).transition(state, answers),
		};
		await expect(
			run(FACTS, breaks, fakeDecider(answering(0.5, (labels) => labels[0] ?? "o1")), { trace }),
		).rejects.toThrow("broken");
		expect(() => replayOf(trace.entries, { fork: 2 })).toThrow("the trace has 1 steps that a fork can repeat");
	});

	it("may end where the domain asks nothing after its repeated steps", async () => {
		const entries = await recorded();
		const short: StateMachine<FactsState> = {
			...factsMachine(facts),
			questions: (state) => (state.looked.length > 0 ? {} : factsMachine(facts).questions(state)),
		};
		const forked = await run(FACTS, short, fakeDecider(answering(0.5)), { replay: replayOf(entries, { fork: 1 }) });
		expect(forked).toMatchObject({ steps: 1, ended: "done" });
	});
});

describe("a replay that does not match", () => {
	it("refuses a trace without a start or an end", async () => {
		const entries = await recorded();
		expect(() => replayOf(entries.slice(1))).toThrow(/start entry/);
		expect(() => replayOf(entries.filter((entry) => entry.type !== "ended"))).toThrow(
			"the trace's run did not end: it stopped before",
		);
	});

	it("finds a recorded pick by its choice's key, so new texts and labels do not matter", async () => {
		const entries = await recorded();
		// With fact b first, Look up b was o2 and is o1 now, and the stop choice has a new text.
		const reordered = factsMachine({ facts: { b: "fact b", a: "fact a", c: "fact c" } }, undefined, 30, "Enough");
		const machine: StateMachine<FactsState> = {
			...reordered,
			transition: () => Promise.reject(new Error("a transition ran again")),
		};
		const result = await run(FACTS, machine, recordedModel(entries), { replay: replayOf(entries) });
		expect(result).toMatchObject({ ended: "done", steps: 4 });
		const first = result.trace.entries.find((entry) => entry.type === "answers");
		expect(first?.type === "answers" ? first.answers[PICK_ID] : undefined).toMatchObject({
			choice: "o1",
			probabilities: { o1: 0.9 },
		});
	});

	it("refuses a recorded answer that does not fit the question that the domain asks now", async () => {
		const entries = await recorded();
		await expect(again(entries, factsMachine({ facts: { z: "other" } }))).rejects.toThrow(
			"the recorded answer to pick, look-up:b, is not among its choices any more",
		);
		// A choice question without a pick's facts is matched by its labels and their texts.
		const bare = entries.map<TraceEntry>((entry) =>
			entry.type === "questions" && entry.step === 1
				? { ...entry, questions: { [PICK_ID]: { type: "choice", instructions: "x", criteria: { o2: "Other" } } } }
				: entry,
		);
		await expect(again(bare)).rejects.toThrow(
			'the recorded answer to pick, "Other", is not among its choices any more',
		);
		const withAnswers = (answers: Extract<TraceEntry, { type: "answers" }>["answers"]) =>
			entries.map<TraceEntry>((entry) =>
				entry.type === "answers" && entry.step === 1 ? { ...entry, answers } : entry,
			);
		const renamed = withAnswers({ other: { type: "bool", probability: 1 } });
		await expect(again(renamed)).rejects.toThrow("step 1 asks pick, but the trace answered other");
		const retyped = withAnswers({ [PICK_ID]: { type: "bool", probability: 1 } });
		await expect(again(retyped)).rejects.toThrow(
			"the trace has a bool answer to pick, which is a choice question now",
		);
	});

	it("refuses a domain that asks nothing where the recorded run asked, in a replay and in a fork", async () => {
		const entries = await recorded();
		const none: StateMachine<FactsState> = { ...unrunnable, questions: () => ({}) };
		const message = "the domain asks nothing after step 0, where the recorded run asked more";
		for (const options of [{}, { fork: 1 }]) {
			await expect(
				run(FACTS, none, fakeDecider(answering(0.5)), { replay: replayOf(entries, options) }),
			).rejects.toThrow(message);
		}
	});

	it("refuses a trace of another domain or case, and notes a changed definition", async () => {
		const entries = await recorded();
		const replay = { replay: replayOf(entries) };
		await expect(run({ ...FACTS, name: "other" }, unrunnable, recordedModel(entries), replay)).rejects.toThrow(
			"the trace is of the domain facts, not of other",
		);
		const named = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.5)), { case: "c1" });
		const ofC1 = { replay: replayOf(named.trace.entries) };
		await expect(run(FACTS, unrunnable, recordedModel(named.trace.entries), { ...ofC1, case: "c2" })).rejects.toThrow(
			"the trace is of the case c1, not of c2",
		);
		const changed = { ...FACTS, limits: { steps: 9, windowShare: 0.9 } };
		const noted = await run(changed, unrunnable, recordedModel(entries), replay);
		expect(noted.trace.entries.find((entry) => entry.type === "note")).toMatchObject({
			message: expect.stringMatching(/^the trace's definition was \w+; this run's is \w+$/) as unknown,
		});
	});

	it("refuses a run that goes on past the recorded run", async () => {
		const entries = await recorded();
		const cut = entries
			.filter((entry) => !(entry.type === "answers" && entry.step === 4))
			.map((entry) => (entry.type === "ended" ? { ...entry, steps: 3 } : entry));
		await expect(again(cut)).rejects.toThrow("the recorded run ended with done after 3 steps, but this run goes on");
		await expect(
			recordedModel(entries).decide({ decisionState: {}, decisionImages: [], decisionQuestions: {} }),
		).rejects.toThrow(ReplayError);
	});

	it("refuses a trace whose states or answers skip a step, or that ends too early", async () => {
		const entries = await recorded();
		expect(() => replayOf(entries.filter((entry) => !(entry.type === "state" && entry.step === 1)))).toThrow(
			"the trace's states skip to step 2",
		);
		expect(() => replayOf(entries.filter((entry) => !(entry.type === "answers" && entry.step === 2)))).toThrow(
			"the trace's answers skip to step 3",
		);
		expect(() => replayOf(entries.filter((entry) => entry.type !== "questions"))).toThrow(
			"the trace has no questions of step 1",
		);
		const list = entries.filter((entry) => !(entry.type === "state" && entry.step === 4));
		await expect(again(list)).rejects.toThrow("the trace has no state after step 4");
	});
});

describe("parseTrace", () => {
	it("reads the JSON Lines it was written as, and its start", async () => {
		const entries = await recorded();
		const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
		expect(parseTrace(`${text}\n\n`)).toEqual(entries);
		expect(startOf(entries)).toMatchObject({ domain: "facts", version: "1.0.0", model: "fake/decider" });
		expect(startOf(entries).limits).toEqual({ steps: 8, windowShare: 0.9 });
		expect(() => startOf(entries.slice(1))).toThrow(/start entry/);
	});
});

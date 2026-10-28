import { describe, expect, it } from "vitest";
import {
	type BoundChoice,
	parseTrace,
	PICK_ID,
	recordedModel,
	ReplayError,
	replayOf,
	run,
	type StateMachine,
	startOf,
	STOP_KEY,
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

/** A recorded run that picks the second choice twice, then stops; `policy` overrides the decider. */
async function recorded(policy?: Policy): Promise<TraceEntry[]> {
	let calls = 0;
	const fallback = answering(0.7, (labels) => (calls++ < 2 ? (labels[1] ?? STOP_KEY) : STOP_KEY));
	return (await run(FACTS, factsMachine(facts), fakeDecider(policy ?? fallback))).trace.entries;
}

const picks = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "pick" ? [entry.choice] : []));
const states = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "state" ? [entry.state] : []));
const isPick = (request: { decisionQuestions: object }) => PICK_ID in request.decisionQuestions;
/** Picks the first choice, then fails the second pick. */
const failsSecondPick: Policy = (request, call) =>
	call === 2 ? failing("down") : answering(0.4, (labels) => labels[0] ?? STOP_KEY)(request, call);

describe("a replay of a whole trace", () => {
	it("repeats the picks, the states, the ending and the answers, asks no model and runs no transition", async () => {
		const entries = await recorded();
		const again = await run(FACTS, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(picks(again.trace.entries)).toEqual(picks(entries));
		expect(states(again.trace.entries)).toEqual(states(entries));
		expect(again).toMatchObject({ ended: "stop", error: null });
		expect(again.state).toEqual({ looked: ["b", "c"], found: ["fact b", "fact c"] });
		expect(again.answers).toEqual({
			a: { type: "bool", probability: 0.7 },
			b: { type: "bool", probability: 0.7 },
			c: { type: "bool", probability: 0.7 },
		});
	});

	it("copies each recorded pick's probabilities and confidence, and marks it as repeated", async () => {
		const entries = await recorded();
		const again = await run(FACTS, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		const recordedPicks = entries.filter((entry) => entry.type === "pick");
		const repeated = again.trace.entries.filter((entry) => entry.type === "pick");
		expect(repeated).toEqual(recordedPicks.map((pick) => ({ ...pick, repeated: true })));
	});

	it("finds each pick by its key, so a new stop text does not matter", async () => {
		const entries = await recorded();
		const renamed = { ...FACTS, stop: "Enough" };
		const again = await run(renamed, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(picks(again.trace.entries)).toEqual(picks(entries));
	});

	it("takes the trace's limits, whatever the domain's are now", async () => {
		const entries = await recorded();
		const tighter = { ...FACTS, limits: { steps: 1, choices: 2, windowShare: 0.5 } };
		const again = await run(tighter, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(again).toMatchObject({ steps: 3, ended: "stop" });
		expect(again.trace.entries[0]).toMatchObject({ limits: FACTS.limits });
	});

	it("ends with a failed pick where the recorded pick failed", async () => {
		const entries = await recorded(failsSecondPick);
		expect(entries.find((entry) => entry.type === "ended")).toEqual({
			type: "ended",
			ended: "pick failed",
			steps: 2,
		});
		const again = await run(FACTS, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(again).toMatchObject({ steps: 2, ended: "pick failed" });
		expect(
			again.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("recorded pick")),
		).toBe(true);
	});

	it("fails the answers as the recorded run did", async () => {
		const entries = await recorded((request, call) =>
			isPick(request) ? answering(0.5, () => STOP_KEY)(request, call) : failing("the provider is down"),
		);
		const again = await run(FACTS, unrunnable, recordedModel(entries), { replay: replayOf(entries) });
		expect(again).toMatchObject({ answers: null, error: "the provider is down" });
	});
});

describe("a replay that asks the questions again", () => {
	it("repeats the steps and how they ended, and asks the model only the questions", async () => {
		const entries = await recorded(failsSecondPick);
		const model = fakeDecider(answering(0.9));
		const again = await run(FACTS, unrunnable, model, { replay: replayOf(entries, { askAgain: true }) });
		expect(again).toMatchObject({ steps: 2, ended: "pick failed" });
		expect(model.requests.some(isPick)).toBe(false);
		expect(again.answers?.["a"]).toEqual({ type: "bool", probability: 0.9 });
	});

	it("needs only the steps to have ended, not the answers", async () => {
		const entries = (await recorded()).filter((entry) => entry.type !== "answers");
		expect(() => replayOf(entries)).toThrow("the trace has no answers: its run stopped before them");
		const again = await run(FACTS, unrunnable, fakeDecider(answering(0.1)), {
			replay: replayOf(entries, { askAgain: true }),
		});
		expect(again).toMatchObject({ steps: 3, ended: "stop", error: null });
	});
});

describe("a fork", () => {
	it("takes the state after some steps, then lets the model pick and answer, and runs its transitions", async () => {
		const entries = await recorded();
		let calls = 0;
		const then = fakeDecider(answering(0.2, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		const forked = await run(FACTS, factsMachine(facts), then, { replay: replayOf(entries, { fork: 1 }) });
		expect(forked.steps).toBe(3);
		expect(forked.state).toEqual({ looked: ["b", "a"], found: ["fact b", "fact a"] });
		expect(forked.answers?.["a"]).toEqual({ type: "bool", probability: 0.2 });
		expect(forked.trace.entries[0]).toMatchObject({ model: "fake/decider" });
		expect(() => replayOf(entries, { fork: 9 })).toThrow(
			"the trace has 3 steps that a fork can repeat, fewer than the fork's 9",
		);
	});

	it("repeats only the steps with a pick and a state: not a failed pick, nor a pick whose transition failed", async () => {
		const failedPick = await recorded(failsSecondPick);
		expect(() => replayOf(failedPick, { fork: 2 })).toThrow("the trace has 1 steps that a fork can repeat");
		expect(replayOf(failedPick, { fork: 1 }).steps).toBe(1);
		const trace = new Trace();
		let transitions = 0;
		const breaks: StateMachine<FactsState, BoundChoice<FactsState>> = {
			...factsMachine(facts),
			transition: (state, choice) =>
				++transitions === 2 ? Promise.reject(new Error("broken")) : factsMachine(facts).transition(state, choice),
		};
		await expect(
			run(FACTS, breaks, fakeDecider(answering(0.5, (labels) => labels[0] ?? STOP_KEY)), { trace }),
		).rejects.toThrow("broken");
		expect(() => replayOf(trace.entries, { fork: 2 })).toThrow("the trace has 1 steps that a fork can repeat");
	});
});

describe("a replay that does not match", () => {
	it("refuses a trace without a start or an end of its steps, and a pick that is not among the choices", async () => {
		const entries = await recorded();
		const again = (list: readonly TraceEntry[], machine: StateMachine<FactsState> = unrunnable) =>
			run(FACTS, machine, recordedModel(list), { replay: replayOf(list) });
		expect(() => replayOf(entries.slice(1))).toThrow(/start entry/);
		expect(() => replayOf(entries.filter((entry) => entry.type !== "ended"))).toThrow(
			"the trace's steps did not end: its run stopped before",
		);
		await expect(again(entries, factsMachine({ facts: { z: "other" } }))).rejects.toThrow(
			/not among the choices any more/,
		);
		const missing = entries.map((entry) => (entry.type === "answers" ? { ...entry, answers: {} } : entry));
		await expect(again(missing)).rejects.toThrow("the trace has no answer for a");
	});

	it("refuses a domain that gives no choices where the recorded run had some, in every kind of replay", async () => {
		const entries = await recorded();
		const none: StateMachine<FactsState> = { ...unrunnable, choices: () => [] };
		const message = "the domain gives no choices after step 0, where the recorded run had some";
		for (const options of [{}, { askAgain: true }, { fork: 1 }]) {
			await expect(
				run(FACTS, none, fakeDecider(answering(0.5)), { replay: replayOf(entries, options) }),
			).rejects.toThrow(message);
		}
		// After a fork's steps, the model goes on, and a state may have no choices.
		const after = await run(FACTS, factsMachine({ facts: { b: "fact b" } }), fakeDecider(answering(0.5)), {
			replay: replayOf(entries, { fork: 1 }),
		});
		expect(after).toMatchObject({ steps: 1, ended: "no choices" });
	});

	it("refuses a trace of another domain or case, and notes a changed definition", async () => {
		const entries = await recorded();
		const replay = { replay: replayOf(entries) };
		await expect(run({ ...FACTS, name: "other" }, unrunnable, recordedModel(entries), replay)).rejects.toThrow(
			"the trace is of the domain facts, not of other",
		);
		const named = await run(FACTS, factsMachine(facts), fakeDecider(answering(0.5, () => STOP_KEY)), { case: "c1" });
		const ofC1 = { replay: replayOf(named.trace.entries) };
		await expect(run(FACTS, unrunnable, recordedModel(named.trace.entries), { ...ofC1, case: "c2" })).rejects.toThrow(
			"the trace is of the case c1, not of c2",
		);
		const renamed = await run({ ...FACTS, stop: "Enough" }, unrunnable, recordedModel(entries), replay);
		const note = renamed.trace.entries.find((entry) => entry.type === "note");
		expect(note).toMatchObject({
			message: expect.stringMatching(/^the trace's definition was \w+; this run's is \w+$/) as unknown,
		});
	});

	it("refuses a run that goes on past the recorded steps", async () => {
		const entries = await recorded();
		const cut = entries.filter((entry) => !(entry.type === "pick" && entry.step === 3));
		await expect(run(FACTS, unrunnable, recordedModel(cut), { replay: replayOf(cut) })).rejects.toThrow(
			"the recorded run ended with stop after 2 steps, but this run goes on",
		);
		await expect(
			recordedModel(entries).decide({ decisionState: {}, decisionImages: [], decisionQuestions: {} }),
		).rejects.toThrow(ReplayError);
	});

	it("refuses a trace whose states skip a step or end too early", async () => {
		const entries = await recorded();
		expect(() => replayOf(entries.filter((entry) => !(entry.type === "state" && entry.step === 1)))).toThrow(
			"the trace's states skip to step 2",
		);
		const list = entries.filter((entry) => !(entry.type === "state" && entry.step === 2));
		await expect(run(FACTS, unrunnable, recordedModel(list), { replay: replayOf(list) })).rejects.toThrow(
			"the trace has no state after step 2",
		);
	});
});

describe("parseTrace", () => {
	it("reads the JSON Lines it was written as, and its start", async () => {
		const entries = await recorded();
		const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
		expect(parseTrace(`${text}\n\n`)).toEqual(entries);
		expect(startOf(entries)).toMatchObject({ domain: "facts", version: "1.0.0", model: "fake/decider" });
		expect(startOf(entries).limits).toEqual({ steps: 8, choices: 30, windowShare: 0.9 });
		expect(() => startOf(entries.slice(1))).toThrow(/start entry/);
	});
});

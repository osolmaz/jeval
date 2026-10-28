import { describe, expect, it } from "vitest";
import {
	limitsOf,
	parseTrace,
	ReplayError,
	replayOf,
	run,
	type StateMachine,
	startOf,
	STOP_KEY,
	type TraceEntry,
} from "../../src/core/index.ts";
import { answering, type Facts, factsMachine, type FactsState, factsTexts, fakeDecider } from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };

/** The same facts with a transition that fails: a replay that ran a transition again would fail. */
const unrunnable: StateMachine<FactsState> = {
	...factsMachine(facts),
	initial: () => Promise.reject(new Error("the initial state was made again")),
	transition: () => Promise.reject(new Error("a transition ran again")),
};

async function recorded(): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider(answering(0.7, (labels) => (calls++ < 2 ? (labels[1] ?? STOP_KEY) : STOP_KEY)));
	return (await run(factsTexts, factsMachine(facts), decider)).trace.entries;
}

const picks = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "pick" ? [entry.key] : []));
const states = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "state" ? [entry.state] : []));

describe("replayOf", () => {
	it("repeats the recorded picks with their recorded states, and the answers, and runs no transition", async () => {
		const entries = await recorded();
		const { decider, replay } = replayOf(entries);
		const again = await run(factsTexts, unrunnable, decider, { replay });
		expect(picks(again.trace.entries)).toEqual(picks(entries));
		expect(states(again.trace.entries)).toEqual(states(entries));
		expect(again.state).toEqual({ looked: ["b", "c"], found: ["fact b", "fact c"] });
		expect(again.answers).toEqual({
			a: { type: "bool", probability: 0.7 },
			b: { type: "bool", probability: 0.7 },
			c: { type: "bool", probability: 0.7 },
		});
	});

	it("forks: takes the state after some steps, then lets another model pick, and runs its transitions", async () => {
		const entries = await recorded();
		let calls = 0;
		const then = fakeDecider(answering(0.2, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		const { decider, replay } = replayOf(entries, { steps: 1, then });
		const forked = await run(factsTexts, factsMachine(facts), decider, { replay });
		expect(forked.steps).toBe(3);
		expect(forked.state).toEqual({ looked: ["b", "a"], found: ["fact b", "fact a"] });
		expect(forked.answers?.["a"]).toEqual({ type: "bool", probability: 0.2 });
		expect(forked.trace.entries[0]).toMatchObject({ model: "fake/decider" });
	});

	it("stops once the recorded picks run out", async () => {
		const entries = await recorded();
		const shortened = entries.filter((entry) => !(entry.type === "pick" && entry.step === 3));
		const { decider, replay } = replayOf(shortened);
		expect((await run(factsTexts, unrunnable, decider, { replay })).steps).toBe(3);
	});

	it("refuses a trace that does not match the run", async () => {
		const entries = await recorded();
		const again = (list: readonly TraceEntry[], machine: StateMachine<FactsState> = unrunnable) => {
			const { decider, replay } = replayOf(list);
			return run(factsTexts, machine, decider, { replay });
		};
		expect(() => replayOf(entries.slice(1))).toThrow(ReplayError);
		await expect(again(entries, factsMachine({ facts: { z: "other" } }))).rejects.toThrow(
			/not among the choices any more/,
		);
		await expect(again(entries.filter((entry) => entry.type !== "answers"))).rejects.toThrow(/no answers/);
		await expect(again(entries.filter((entry) => entry.type !== "choices"))).rejects.toThrow(/fewer picks/);
		const missing = entries.map((entry) => (entry.type === "answers" ? { ...entry, answers: {} } : entry));
		await expect(again(missing)).rejects.toThrow(/no answer for a/);
	});

	it("refuses a trace whose states skip a step or end too early", async () => {
		const entries = await recorded();
		expect(() => replayOf(entries.filter((entry) => !(entry.type === "state" && entry.step === 1)))).toThrow(
			"the trace's states skip to step 2",
		);
		const { decider, replay } = replayOf(entries.filter((entry) => !(entry.type === "state" && entry.step === 2)));
		await expect(run(factsTexts, unrunnable, decider, { replay })).rejects.toThrow(
			"the trace has no state after step 2",
		);
	});
});

describe("parseTrace", () => {
	it("reads the JSON Lines it was written as, its start and its limits", async () => {
		const entries = await recorded();
		const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
		expect(parseTrace(`${text}\n\n`)).toEqual(entries);
		expect(startOf(entries)).toMatchObject({ domain: "facts", version: "1.0.0", model: "fake/decider" });
		expect(limitsOf(entries)).toEqual({ steps: 8, choices: 30, windowShare: 0.9 });
		expect(() => limitsOf(entries.slice(1))).toThrow(/start entry/);
	});
});

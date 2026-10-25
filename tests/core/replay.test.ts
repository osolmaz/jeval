import { describe, expect, it } from "vitest";
import {
	limitsOf,
	parseTrace,
	replayDecider,
	ReplayError,
	run,
	STOP_KEY,
	type TraceEntry,
} from "../../src/core/index.ts";
import { answering, type Facts, factsDomain, fakeDecider } from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };

async function recorded(): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider(answering(0.7, (labels) => (calls++ < 2 ? (labels[1] ?? STOP_KEY) : STOP_KEY)));
	return (await run(factsDomain, facts, decider, { case: "c" })).trace.entries;
}

describe("replayDecider", () => {
	it("repeats the recorded steps and answers", async () => {
		const entries = await recorded();
		const again = await run(factsDomain, facts, replayDecider(entries), { case: "c" });
		const keys = (list: readonly TraceEntry[]) =>
			list.flatMap((entry) => (entry.type === "choice" ? [entry.key] : []));
		expect(keys(again.trace.entries)).toEqual(keys(entries));
		expect(again.answers).toEqual({
			a: { kind: "bool", probability: 0.7 },
			b: { kind: "bool", probability: 0.7 },
			c: { kind: "bool", probability: 0.7 },
		});
	});

	it("forks: repeats some steps, then lets another model decide and answer", async () => {
		const entries = await recorded();
		const then = fakeDecider(answering(0.2, () => STOP_KEY));
		const forked = await run(factsDomain, facts, replayDecider(entries, { steps: 1, then }), { case: "c" });
		expect(forked.steps).toBe(2);
		expect(forked.answers?.["a"]).toEqual({ kind: "bool", probability: 0.2 });
		expect(forked.trace.entries[0]).toMatchObject({ model: "fake/decider" });
	});

	it("stops once the recorded steps run out", async () => {
		const entries = await recorded();
		const shortened = entries.filter((entry) => !(entry.type === "choice" && entry.step === 3));
		const replayed = await run(factsDomain, facts, replayDecider(shortened), { case: "c" });
		expect(replayed.steps).toBe(3);
	});

	it("refuses a trace that does not match the run", async () => {
		const entries = await recorded();
		expect(() => replayDecider(entries.slice(1))).toThrow(ReplayError);
		await expect(run(factsDomain, { facts: { z: "other" } }, replayDecider(entries), { case: "c" })).rejects.toThrow(
			/not on the menu/,
		);
		const noAnswers = entries.filter((entry) => entry.type !== "answers" && entry.type !== "asked");
		await expect(run(factsDomain, facts, replayDecider(noAnswers), { case: "c" })).rejects.toThrow(/no answers/);
		const fewer = entries.filter((entry) => entry.type !== "menu");
		await expect(run(factsDomain, facts, replayDecider(fewer), { case: "c" })).rejects.toThrow(/fewer choices/);
		const missing = entries.map((entry) =>
			entry.type === "answers" || entry.type === "asked" ? { ...entry, answers: {} } : entry,
		);
		await expect(run(factsDomain, facts, replayDecider(missing), { case: "c" })).rejects.toThrow(/no answer for a/);
	});
});

describe("parseTrace", () => {
	it("reads the JSON Lines it was written as, and the limits of its case", async () => {
		const entries = await recorded();
		const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
		expect(parseTrace(`${text}\n\n`)).toEqual(entries);
		expect(limitsOf(entries)).toEqual({ steps: 8, options: 30, windowShare: 0.9 });
		expect(() => limitsOf(entries.slice(1))).toThrow(/case entry/);
	});
});

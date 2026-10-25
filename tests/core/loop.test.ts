import { describe, expect, it } from "vitest";
import { batches, type Domain, estimateTokens, type Question, run, STOP_KEY, Trace } from "../../src/core/index.ts";
import { answering, type Facts, factsDomain, failing, fakeDecider } from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b" } };
const firstOption = (labels: string[]) => labels[0] ?? STOP_KEY;

describe("run", () => {
	it("takes steps until the model stops, then answers every question", async () => {
		let calls = 0;
		const decider = fakeDecider(answering(0.8, (labels) => (calls++ === 0 ? firstOption(labels) : STOP_KEY)));
		const result = await run(factsDomain, facts, decider, { case: "c1" });
		expect(result.steps).toBe(2);
		expect(result.error).toBeNull();
		expect(result.answers).toEqual({ a: { kind: "bool", probability: 0.8 }, b: { kind: "bool", probability: 0.8 } });
		expect(result.trace.entries.map((entry) => entry.type)).toEqual([
			"case",
			"menu",
			"choice",
			"observation",
			"menu",
			"choice",
			"asked",
			"answers",
		]);
		expect(result.trace.entries.at(-1)?.parent).toBe(result.trace.entries.at(-2)?.id);
	});

	it("records each option's probability under its key", async () => {
		const result = await run(factsDomain, facts, fakeDecider(answering(0.5, firstOption)), {
			case: "c1",
			limits: { steps: 1, options: 30, windowShare: 0.9 },
		});
		const choice = result.trace.entries.find((entry) => entry.type === "choice");
		expect(choice).toMatchObject({ key: "look-up:a", probabilities: { "look-up:a": 0.9 } });
	});

	it("stops gathering when the menu is empty or the step limit is reached", async () => {
		const empty = await run(factsDomain, { facts: {} }, fakeDecider(answering(0.5, firstOption)), { case: "c" });
		expect(empty.steps).toBe(0);
		const limited = await run(
			factsDomain,
			{ facts: { a: "1", b: "2", c: "3" } },
			fakeDecider(answering(0.5, firstOption)),
			{ case: "c", limits: { steps: 2, options: 30, windowShare: 0.9 } },
		);
		expect(limited.steps).toBe(2);
	});

	it("goes on to the answers when a choice fails or names no choice", async () => {
		const failed = await run(
			factsDomain,
			facts,
			fakeDecider((request, call) => (call === 1 ? failing("provider") : answering(0.9)(request, call))),
			{ case: "c" },
		);
		expect(failed.answers).not.toBeNull();
		expect(
			failed.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("choice failed")),
		).toBe(true);
		const silent = await run(
			factsDomain,
			facts,
			fakeDecider((request, call) =>
				call === 1
					? { ok: true, answers: {}, usage: { inputTokens: null, milliseconds: 0 } }
					: answering(0.9)(request, call),
			),
			{ case: "c" },
		);
		expect(silent.trace.entries.some((entry) => entry.type === "note" && entry.message.includes("no choice"))).toBe(
			true,
		);
	});

	it("sends a smaller view when the model reports the window was exceeded, and notes what the view left out", async () => {
		const decider = fakeDecider(
			(request, call) =>
				call === 1 ? failing("window", "max_tokens_exceeded") : answering(0.6, () => STOP_KEY)(request, call),
			120,
		);
		const result = await run(factsDomain, facts, decider, { case: "c" });
		expect(result.answers).not.toBeNull();
		const rooms = decider.requests.map((request) => request.state["tokens"]);
		expect(Number(rooms[1])).toBeLessThan(Number(rooms[0]));
		expect(
			result.trace.entries.some((entry) => entry.type === "note" && entry.message.startsWith("the view left out")),
		).toBe(true);
	});

	it("gives up on the answers after three window failures", async () => {
		const result = await run(
			factsDomain,
			facts,
			fakeDecider(() => failing("window")),
			{ case: "c" },
		);
		expect(result.answers).toBeNull();
		expect(result.error).toBe("window: failed");
	});

	it("reports a question the model did not answer", async () => {
		const partial = fakeDecider((request) =>
			request.questions[0]?.kind === "choice"
				? answering(0.5, () => STOP_KEY)(request, 0)
				: {
						ok: true,
						answers: { a: { kind: "bool", probability: 1 } },
						usage: { inputTokens: 1, milliseconds: 1 },
					},
		);
		const result = await run(factsDomain, facts, partial, { case: "c" });
		expect(result.error).toBe("no answer for b");
	});

	it("starts from the domain's opening observations and writes entries to the sink", async () => {
		const seen: string[] = [];
		const opening: Domain<Facts> = {
			...factsDomain,
			start: () =>
				Promise.resolve([{ action: "open", key: "open:x", observation: { source: "x", text: "opened" } }]),
		};
		await run(opening, facts, fakeDecider(answering(0.5, () => STOP_KEY)), {
			case: "c",
			trace: new Trace((entry) => seen.push(entry.type)),
		});
		expect(seen.slice(0, 2)).toEqual(["case", "observation"]);
	});
});

describe("batches", () => {
	const question = (id: string): Question => ({ kind: "bool", id, instructions: "x".repeat(30), yes: "y", no: "n" });

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

	it("shows the opening observations to the model", async () => {
		const opening: Domain<Facts> = {
			...factsDomain,
			start: () =>
				Promise.resolve([{ action: "open", key: "open:x", observation: { source: "x", text: "opened" } }]),
		};
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(opening, facts, decider, { case: "c" });
		expect(decider.requests[0]?.state["seen"]).toEqual(["opened"]);
	});

	it("labels the options o1, o2… and keeps one place on the menu for stop", async () => {
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(factsDomain, three, decider, { case: "c", limits: { steps: 8, options: 2, windowShare: 0.9 } });
		const question = decider.requests[0]?.questions[0];
		expect(question?.kind === "choice" ? question.choices : null).toEqual({ o1: "Look up a", stop: "Stop" });
	});

	it("gives the view the window's share less the questions' size", async () => {
		const decider = fakeDecider(answering(0.5, () => STOP_KEY));
		await run(factsDomain, facts, decider, { case: "c" });
		const [choice, answers] = decider.requests;
		const room = (request: typeof choice) => Number(request?.state["tokens"]);
		expect(room(choice)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(choice?.questions, 3));
		expect(room(answers)).toBe(Math.floor(64_000 * 0.9) - estimateTokens(answers?.questions, 3));
	});

	it("splits the answers into batches that fit the window, and keeps every batch's usage", async () => {
		const decider = fakeDecider(
			answering(0.5, () => STOP_KEY),
			200,
		);
		const result = await run(factsDomain, three, decider, { case: "c" });
		const answerRequests = decider.requests.filter((request) => request.questions[0]?.kind === "bool");
		expect(answerRequests.length).toBe(2);
		expect(result.trace.entries.find((entry) => entry.type === "answers")).toMatchObject({ usage: [{}, {}] });
	});

	it("names every unanswered question, and notes each retry and what the view left out", async () => {
		const silent = fakeDecider((request) =>
			request.questions[0]?.kind === "choice"
				? answering(0.5, () => STOP_KEY)(request, 0)
				: { ok: true, answers: {}, usage: { inputTokens: 1, milliseconds: 1 } },
		);
		expect((await run(factsDomain, facts, silent, { case: "c" })).error).toBe("no answer for a, b");
		const tight = fakeDecider(
			(request, call) => (call === 1 ? failing("window") : answering(0.5, () => STOP_KEY)(request, call)),
			120,
		);
		const notes = (await run(factsDomain, facts, tight, { case: "c" })).trace.entries.flatMap((entry) =>
			entry.type === "note" ? [entry.message] : [],
		);
		expect(notes).toContain("the view left out: everything; the rest");
		expect(
			notes.some((note) => /^the request did not fit the model's window; trying a view of \d+ tokens$/.test(note)),
		).toBe(true);
	});
});

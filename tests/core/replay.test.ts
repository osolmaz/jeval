import { describe, expect, it } from "vitest";
import {
	action,
	type Domain,
	type Image,
	limitsOf,
	parseTrace,
	ReplayError,
	replayOf,
	run,
	STOP_KEY,
	type TraceEntry,
} from "../../src/core/index.ts";
import { answering, type Facts, factsDomain, fakeDecider } from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };
/** The same facts, found other ones now: a replay that ran the actions again would see the difference. */
const changed: Facts = { facts: { a: "now a", b: "now b", c: "now c" } };

async function recorded(): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider(answering(0.7, (labels) => (calls++ < 2 ? (labels[1] ?? STOP_KEY) : STOP_KEY)));
	return (await run(factsDomain, facts, decider, { case: "c" })).trace.entries;
}

const choices = (list: readonly TraceEntry[]) => list.flatMap((entry) => (entry.type === "choice" ? [entry.key] : []));
const texts = (list: readonly TraceEntry[]) =>
	list.flatMap((entry) => (entry.type === "observation" ? [entry.text] : []));

describe("replayOf", () => {
	it("repeats the recorded steps with their recorded observations, and the answers, without running an action", async () => {
		const entries = await recorded();
		const { decider, replay } = replayOf(entries);
		const again = await run(factsDomain, changed, decider, { case: "c", replay });
		expect(choices(again.trace.entries)).toEqual(choices(entries));
		expect(texts(again.trace.entries)).toEqual(["fact b", "fact c"]);
		expect(again.answers).toEqual({
			a: { kind: "bool", probability: 0.7 },
			b: { kind: "bool", probability: 0.7 },
			c: { kind: "bool", probability: 0.7 },
		});
	});

	it("forks: repeats some steps and their observations, then lets another model decide, and runs its steps", async () => {
		const entries = await recorded();
		let calls = 0;
		const then = fakeDecider(answering(0.2, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
		const { decider, replay } = replayOf(entries, { steps: 1, then });
		const forked = await run(factsDomain, changed, decider, { case: "c", replay });
		expect(forked.steps).toBe(3);
		expect(texts(forked.trace.entries)).toEqual(["fact b", "now a"]);
		expect(forked.answers?.["a"]).toEqual({ kind: "bool", probability: 0.2 });
		expect(forked.trace.entries[0]).toMatchObject({ model: "fake/decider" });
	});

	it("stops once the recorded steps run out", async () => {
		const entries = await recorded();
		const shortened = entries.filter((entry) => !(entry.type === "choice" && entry.step === 3));
		const { decider, replay } = replayOf(shortened);
		expect((await run(factsDomain, facts, decider, { case: "c", replay })).steps).toBe(3);
	});

	it("refuses a trace that does not match the run", async () => {
		const entries = await recorded();
		const again = (list: readonly TraceEntry[], workspace: Facts = facts) => {
			const { decider, replay } = replayOf(list);
			return run(factsDomain, workspace, decider, { case: "c", replay });
		};
		expect(() => replayOf(entries.slice(1))).toThrow(ReplayError);
		await expect(again(entries, { facts: { z: "other" } })).rejects.toThrow(/not on the menu/);
		await expect(
			again(entries.filter((entry) => entry.type !== "answers" && entry.type !== "asked")),
		).rejects.toThrow(/no answers/);
		await expect(again(entries.filter((entry) => entry.type !== "menu"))).rejects.toThrow(/fewer choices/);
		const missing = entries.map((entry) =>
			entry.type === "answers" || entry.type === "asked" ? { ...entry, answers: {} } : entry,
		);
		await expect(again(missing)).rejects.toThrow(/no answer for a/);
	});

	it("refuses a step whose recorded observation is missing or belongs to another option", async () => {
		const entries = await recorded();
		const again = (list: readonly TraceEntry[]) => {
			const { decider, replay } = replayOf(list);
			return run(factsDomain, facts, decider, { case: "c", replay });
		};
		await expect(again(entries.filter((entry) => entry.type !== "observation"))).rejects.toThrow(
			"step 1 took look-up:b; the trace took no step",
		);
		const moved = entries.map((entry) => (entry.type === "observation" ? { ...entry, key: "look-up:a" } : entry));
		await expect(again(moved)).rejects.toThrow("step 1 took look-up:b; the trace took look-up:a");
	});
});

/** A domain whose start and whose one action show a picture: a trace keeps only the pictures' labels. */
interface Pictures {
	readonly label: string;
	/** How many pictures the start shows. */
	readonly covers: number;
}

const picture = (label: string): Image => ({ label, mimeType: "image/png", data: "AA==" });
let looks = 0;

const look = action<Pictures, null>({
	name: "look",
	options: () => [{ key: "picture", text: "Look at the picture", arg: null }],
	observe: (workspace) => {
		looks += 1;
		return { source: "picture", text: `[image: ${workspace.label}]`, images: [picture(workspace.label)] };
	},
});

const picturesDomain: Domain<Pictures> = {
	name: "pictures",
	version: "1.0.0",
	actions: [look],
	stop: "Stop",
	choose: "Look or stop.",
	questions: () => [],
	start: (workspace) =>
		Promise.resolve(
			Array.from({ length: workspace.covers }, (_, index) => ({
				action: "start",
				key: `cover:${String(index)}`,
				observation: { source: "cover", text: "[image: cover]", images: [picture(`cover ${workspace.label}`)] },
			})),
		),
	view: () => ({ state: {}, images: [], omitted: [] }),
};

async function lookedAt(workspace: Pictures): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider(answering(0.5, (labels) => (calls++ === 0 ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
	return (await run(picturesDomain, workspace, decider, { case: "p" })).trace.entries;
}

describe("replayOf with images", () => {
	it("runs the start and a step again for their images, which must be the same as recorded", async () => {
		const workspace = { label: "x", covers: 1 };
		const entries = await lookedAt(workspace);
		looks = 0;
		const replaying = (pictures: Pictures) => {
			const { decider, replay } = replayOf(entries);
			return run(picturesDomain, pictures, decider, { case: "p", replay });
		};
		const again = await replaying(workspace);
		expect(looks).toBe(1);
		expect(again.log.map((entry) => entry.observation.images?.map((image) => image.label))).toEqual([
			["cover x"],
			["x"],
		]);
		await expect(replaying({ label: "y", covers: 1 })).rejects.toThrow(
			"cover:0 found something other than what the trace recorded",
		);
		await expect(replaying({ label: "x", covers: 2 })).rejects.toThrow(
			"the start found other observations than the trace",
		);
	});

	it("refuses a step with images that finds something else when it runs again", async () => {
		const entries = await lookedAt({ label: "x", covers: 0 });
		const { decider, replay } = replayOf(entries);
		await expect(run(picturesDomain, { label: "y", covers: 0 }, decider, { case: "p", replay })).rejects.toThrow(
			"look:picture found something other than what the trace recorded",
		);
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

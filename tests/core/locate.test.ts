import { describe, expect, it } from "vitest";
import {
	type Answer,
	type Ask,
	type AskOptions,
	locate,
	locateAll,
	type Node,
	type Question,
	strongestPicks,
} from "../../src/core/index.ts";

/** A tree of sections and sentences; the evidence is "s2b". */
const leaf = (id: string): Node => ({ id, title: `sentence ${id}` });
const tree: Node = {
	id: "root",
	title: "the answer",
	children: () => [
		{ id: "s1", title: "section one", children: () => [leaf("s1a"), leaf("s1b")] },
		{ id: "s2", title: "section two", children: () => [leaf("s2a"), leaf("s2b")] },
		{
			id: "s3",
			title: "section three",
			children: () => [{ id: "s3p", title: "one paragraph", children: () => [leaf("s3a")] }],
		},
	],
};

/** The option whose text contains the wanted words for this question, else the last option. */
function chosenFor(question: Question, wanted: Readonly<Record<string, string>>): string {
	if (question.kind !== "choice") return "none";
	const target = Object.entries(wanted).find(([prefix]) => question.id.startsWith(prefix))?.[1];
	const entries = Object.entries(question.choices);
	const match = target === undefined ? undefined : entries.find(([, text]) => text.includes(target));
	return match?.[0] ?? entries.at(-1)?.[0] ?? "none";
}

/** An ask that answers each choice with `chosenFor`, and records each call. */
function picking(
	wanted: Record<string, string>,
	calls: { questions: readonly Question[]; options: AskOptions }[],
): Ask {
	return (questions, options) => {
		calls.push({ questions, options });
		const answers: Record<string, Answer> = {};
		for (const question of questions) {
			const choice = chosenFor(question, wanted);
			answers[question.id] = { kind: "choice", choice, probabilities: { [choice]: 0.8 } };
		}
		return Promise.resolve(answers);
	};
}

const options = { stage: "point", state: { stage: "pointing" }, none: "Nothing here." };

describe("locate", () => {
	it("descends one level at a time, all searches in one request per level", async () => {
		const calls: { questions: readonly Question[]; options: AskOptions }[] = [];
		const wanted = { a: "two", b: "three" };
		const found = await locate(
			picking({ "a/0": "section two", "a/1": "s2b", "b/0": "section three" }, calls),
			[
				{ id: "a", root: tree, question: "Where is it?" },
				{ id: "b", root: tree, question: "Where is it?" },
			],
			options,
		);
		expect(found.get("a")?.path.map((node) => node.id)).toEqual(["s2", "s2b"]);
		expect(found.get("a")?.probability).toBeCloseTo(0.64);
		expect(found.get("b")?.path.map((node) => node.id)).toEqual(["s3", "s3p", "s3a"]);
		expect(calls.map((call) => call.options.stage)).toEqual(["point 1", "point 2"]);
		expect(calls[0]?.options.state).toEqual({ stage: "pointing" });
		expect(calls[1]?.questions[0]?.instructions).toContain("You are looking inside: section two.");
		expect(wanted).toBeDefined();
	});

	it("ends with no place when the model answers none", async () => {
		const found = await locate(picking({}, []), [{ id: "a", root: tree, question: "Where?" }], options);
		expect(found.get("a")).toBeNull();
	});

	it("offers candidates first, and looks through the whole tree when the model asks to", async () => {
		const calls: { questions: readonly Question[]; options: AskOptions }[] = [];
		const candidates = [leaf("s1a"), leaf("s3a")];
		const direct = await locate(
			picking({ "a/0": "s3a" }, calls),
			[{ id: "a", root: tree, question: "Where?", candidates }],
			options,
		);
		expect(direct.get("a")?.path.map((node) => node.id)).toEqual(["s3a"]);
		expect(Object.keys(calls[0]?.questions[0]?.kind === "choice" ? calls[0].questions[0].choices : {})).toEqual([
			"n0",
			"n1",
			"none",
			"elsewhere",
		]);
		const wider = await locate(
			picking({ "a/0": "look in the whole text", "a/1": "section one", "a/2": "s1b" }, []),
			[{ id: "a", root: tree, question: "Where?", candidates }],
			options,
		);
		expect(wider.get("a")?.path.map((node) => node.id)).toEqual(["s1", "s1b"]);
	});

	it("shows a long level in overlapping windows and takes the strongest pick", async () => {
		const long: Node = {
			id: "r",
			title: "r",
			children: () => Array.from({ length: 30 }, (_, index) => leaf(`x${String(index)}`)),
		};
		const calls: { questions: readonly Question[]; options: AskOptions }[] = [];
		const found = await locate(picking({ "a/0/w18": "x25" }, calls), [{ id: "a", root: long, question: "Where?" }], {
			...options,
			options: 12,
		});
		expect(calls[0]?.questions.map((question) => question.id)).toEqual(["a/0/w0", "a/0/w6", "a/0/w12", "a/0/w18"]);
		expect(calls[0]?.questions[3]?.instructions).toContain("These are options 19 to 30 of 30.");
		expect(found.get("a")?.path.map((node) => node.id)).toEqual(["x25"]);
	});

	it("needs no question for a tree with one path", async () => {
		const calls: { questions: readonly Question[]; options: AskOptions }[] = [];
		const single: Node = {
			id: "r",
			title: "r",
			children: () => [{ id: "p", title: "p", children: () => [leaf("only")] }],
		};
		const found = await locate(
			picking({}, calls),
			[
				{ id: "a", root: single, question: "Where?" },
				{ id: "b", root: leaf("empty"), question: "Where?" },
			],
			options,
		);
		expect(found.get("a")?.path.map((node) => node.id)).toEqual(["p", "only"]);
		expect(found.get("b")).toBeNull();
		expect(calls).toEqual([]);
	});
});

describe("locateAll", () => {
	it("marks every strong pick of a flat level, merging neighbours into the strongest", async () => {
		const level: Node = {
			id: "r",
			title: "r",
			children: () => Array.from({ length: 20 }, (_, index) => leaf(`g${String(index)}`)),
		};
		const ask: Ask = (questions) =>
			Promise.resolve(
				Object.fromEntries(
					questions.map((question) => {
						const pick = question.id.endsWith("/w0") ? "n4" : question.id.endsWith("/w6") ? "n5" : "n15";
						const p = question.id.endsWith("/w6") ? 0.6 : 0.9;
						return [question.id, { kind: "choice", choice: pick, probabilities: { [pick]: p } } satisfies Answer];
					}),
				),
			);
		const marked = await locateAll(ask, [{ id: "a", root: level, question: "Where do parts start?" }], options);
		expect(marked.get("a")?.map((pointer) => pointer.path[0]?.id)).toEqual(["g4", "g15"]);
	});

	it("keeps only picks above the threshold", () => {
		expect(
			strongestPicks(
				[
					[3, 0.4],
					[9, 0.7],
					[10, 0.9],
				],
				0.5,
				2,
			),
		).toEqual([[10, 0.9]]);
	});
});

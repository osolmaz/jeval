import { describe, expect, it } from "vitest";
import { run, STOP_KEY, type TraceEntry } from "../../src/core/index.ts";
import { casePage, escape, indexPage, plain, type Story, storyOf } from "../../src/view/index.ts";
import { answering, type Facts, factsDomain, failing, fakeDecider } from "../helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact <b>" } };

async function traced(): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider((request, call) => {
		calls = call;
		if (call === 2) return failing("provider", "down");
		return answering(0.7, (labels) => labels[0] ?? STOP_KEY)(request, call);
	});
	const domain = {
		...factsDomain,
		start: () =>
			Promise.resolve([{ action: "start", key: "start", observation: { source: "intro", text: "Hello" } }]),
	};
	const result = await run(domain, facts, decider, { case: "c1" });
	expect(calls).toBeGreaterThan(2);
	return result.trace.entries;
}

describe("storyOf", () => {
	it("reads the case and its opening", async () => {
		const story = storyOf(await traced());
		expect(story).toMatchObject({ case: "c1", domain: "facts", model: "fake/decider" });
		expect(story.opening).toEqual([{ source: "intro", text: "Hello", data: undefined }]);
		expect(story.frames).toHaveLength(2);
	});

	it("reads each step: what the model saw, every option's probability, its choice and what the step found", async () => {
		const [first] = storyOf(await traced()).frames;
		expect(first).toMatchObject({
			step: 1,
			chosen: "look-up:a",
			before: { text: "Hello" },
			after: { text: "fact a" },
		});
		expect(first?.options.map((option) => [option.key, option.probability, option.chosen])).toEqual([
			["look-up:a", 0.9, true],
			["look-up:b", null, false],
			["stop", null, false],
		]);
	});

	it("reads a failed choice as a step without a choice, with its note, then the answers", async () => {
		const story = storyOf(await traced());
		const second = story.frames[1];
		expect(second).toMatchObject({ step: 2, chosen: null, after: null, before: { text: "fact a" } });
		expect(second?.notes[0]).toMatch(/^the choice failed \(provider\): down/);
		expect(story.last?.text).toBe("fact a");
		expect(story.answers).toEqual({ a: { kind: "bool", probability: 0.7 }, b: { kind: "bool", probability: 0.7 } });
	});

	it("refuses a trace that does not start with its case", () => {
		expect(() => storyOf([])).toThrow(/starts with its case/);
	});
});

const story: Story = {
	case: "c<1>",
	domain: "facts",
	model: "fake/decider",
	opening: [{ source: "intro", text: "Hello", data: null }],
	frames: [
		{
			step: 1,
			before: null,
			options: [
				...Array.from({ length: 12 }, (_, index) => ({
					key: `k${String(index)}`,
					text: `option ${String(index)}`,
					probability: 0.01 * (index + 1),
					chosen: false,
					data: null,
				})),
				{ key: "x", text: "<script>bad()</script>", probability: 0.0005, chosen: true, data: null },
			],
			chosen: "x",
			after: { source: "x", text: "found & kept", data: null },
			notes: ["a note"],
		},
	],
	last: null,
	answers: {
		yes: { kind: "bool", probability: 0.25 },
		pick: { kind: "choice", choice: "b", probabilities: { b: 0.6 } },
		level: { kind: "score", score: 1.5, confidence: 0.4 },
	},
	notes: ["outside a step"],
};

describe("the case page", () => {
	it("has a section for the start, each step and the end, and escapes every text", () => {
		const page = casePage({ story, outcome: null, live: null });
		expect(page.match(/<section class="frame/g)).toHaveLength(3);
		expect(page).toContain('&lt;script&gt;bad()&lt;/script&gt;<span class="hidden"> (chosen)</span>');
		expect(page).not.toContain("<script>bad()");
		expect(page).toContain("<h1>c&lt;1&gt;</h1>");
		expect(page).toContain("found &amp; kept");
		expect(page).toContain("The case has no result yet.");
		expect(page).not.toContain("data-live");
	});

	it("lists the ten likeliest options and the chosen one, and counts the rest", () => {
		const page = casePage({ story, outcome: null, live: null });
		expect(page.match(/<li[ >]/g)).toHaveLength(11);
		expect(page).toContain("and 2 more options");
		expect(page).toContain("12.0%");
		expect(page).toContain("0.05%");
	});

	it("shows the outcome, the answers and the notes at the end, and the domain's picture", () => {
		const page = casePage({
			story,
			outcome: { result: "win", material: { white: 3 }, moves: 4 },
			picture: (seen, options) => `<svg data-options="${String(options.length)}">${seen?.text ?? "none"}</svg>`,
			live: { url: "/case/c1/version", version: "10:false" },
		});
		expect(page).toContain("<dt>material</dt><dd>white 3</dd>");
		expect(page).toContain("<dt>yes</dt><dd>yes 25.0%</dd>");
		expect(page).toContain("<dt>pick</dt><dd>b 60.0%</dd>");
		expect(page).toContain("<dt>level</dt><dd>1.50 (confidence 40.0%)</dd>");
		expect(page).toContain("outside a step");
		expect(page).toContain('<svg data-options="13">none</svg>');
		expect(page).toContain('<svg data-options="0">Hello</svg>');
		expect(page).toContain('data-live="/case/c1/version" data-version="10:false"');
	});

	it("links every case of a run from the index", () => {
		const page = indexPage("runs/a", [
			{ id: "x y", outcome: "win, checkmate" },
			{ id: "z", outcome: null },
		]);
		expect(page).toContain('<a href="/case/x%20y">x y</a> <span class="meta">win, checkmate</span>');
		expect(page).toContain('<a href="/case/z">z</a></li>');
	});

	it("writes values and lists as plain text", () => {
		expect(plain([1, "a", { b: true }])).toBe("1, a, b true");
		expect(plain(null)).toBe("null");
		expect(escape(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
	});
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { PICK_ID, run, type TraceEntry } from "@osolmaz/switch";
import {
	buildScript,
	escape,
	indexPage,
	partConfigs,
	partStyles,
	scriptJson,
	storyOf,
	viewerModules,
	viewerPage,
	viewerScript,
} from "../src/index.ts";
import { answering, type Facts, factsMachine, FACTS, failing, fakeDecider, START } from "./helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact <b>" } };
const opened = { ...START, looked: ["intro"], found: ["Hello"] };
const afterA = { ...START, looked: ["intro", "a"], found: ["Hello", "fact a"] };

/** A run that looks up a, then fails at its second request. */
async function traced(): Promise<TraceEntry[]> {
	const decider = fakeDecider((request, call) =>
		call === 2 ? failing("down") : answering(0.7, (labels) => labels[0] ?? "o1")(request, call),
	);
	return (await run(FACTS, factsMachine(facts, opened), decider)).trace.entries;
}

const START_ENTRY: TraceEntry = {
	type: "start",
	domain: "facts",
	version: "1",
	definition: "d",
	case: "c1",
	model: "m",
	limits: FACTS.limits,
};

describe("storyOf", () => {
	it("reads the case's name, its domain and model, and its initial state", async () => {
		const story = storyOf(await traced(), "c1");
		expect(story).toMatchObject({ case: "c1", domain: "facts", model: "fake/decider" });
		expect(story.initial).toEqual(opened);
		expect(story.frames).toHaveLength(2);
	});

	it("reads each step: the state it asked in, every choice's probability, the pick and the state after", async () => {
		const [first] = storyOf(await traced(), "c1").frames;
		expect(first).toMatchObject({ step: 1, pick: 0, answered: true, before: opened, after: afterA });
		const pick = first?.questions[0];
		expect(pick).toMatchObject({ id: PICK_ID, cut: 0, answer: { type: "choice", choice: "o1" } });
		expect(pick?.choices.map((choice) => [choice.label, choice.key, choice.probability, choice.picked])).toEqual([
			["o1", "look-up:a", 0.9, true],
			["o2", "look-up:b", null, false],
			["o3", "stop:stop", null, false],
		]);
	});

	it("reads a failed step as a step without answers, and the run's failure", async () => {
		const story = storyOf(await traced(), "c1");
		const second = story.frames[1];
		expect(second).toMatchObject({ step: 2, answered: false, after: null, before: afterA, notes: [] });
		expect(second?.questions[0]?.answer).toBeNull();
		expect(story.last).toEqual(afterA);
		expect(story).toMatchObject({ ended: "failed", error: "down", thrown: null });
	});

	it("reads the answers of questions of every type, and a choice question without facts by its labels", () => {
		const entries: TraceEntry[] = [
			START_ENTRY,
			{ type: "state", step: 0, state: opened },
			{
				type: "questions",
				step: 1,
				questions: {
					sure: { type: "bool", instructions: "Sure?", criteria: { true: "yes", false: "no" } },
					which: { type: "choice", instructions: "Which?", criteria: { x: "X", y: "Y" } },
				},
			},
			{
				type: "answers",
				step: 1,
				answers: {
					sure: { type: "bool", probability: 0.6 },
					which: { type: "choice", choice: "y", probabilities: { x: 0.2, y: 0.8 }, confidence: 0.6 },
				},
			},
		];
		const [frame] = storyOf(entries, "c1").frames;
		expect(frame?.pick).toBe(1);
		expect(frame?.questions[0]).toMatchObject({ id: "sure", answer: { probability: 0.6 }, choices: [] });
		expect(frame?.questions[1]?.choices.map((choice) => [choice.key, choice.probability, choice.picked])).toEqual([
			["x", 0.2, false],
			["y", 0.8, true],
		]);
	});

	it("gives a note to the step that waits for its answers, and the notes after the run ended to the story", () => {
		const retry = "the request did not fit the model's window; trying a view of 9 tokens";
		const pick = {
			type: "choice" as const,
			instructions: "Pick.",
			criteria: { o1: "Stop" },
			data: { choices: { o1: { key: "stop", type: "stop" } }, cut: 3 },
		};
		const entries: TraceEntry[] = [
			START_ENTRY,
			{ type: "state", step: 0, state: opened },
			{ type: "questions", step: 1, questions: { [PICK_ID]: pick } },
			{ type: "note", message: retry },
			{ type: "ended", ended: "failed", steps: 1, error: "too long" },
			{ type: "note", message: "after" },
		];
		const story = storyOf(entries, "c1");
		expect(story.frames[0]?.questions[0]).toMatchObject({ cut: 3 });
		expect(story.frames[0]?.notes).toEqual([retry]);
		expect(story.notes).toEqual(["after"]);
		expect(story).toMatchObject({ ended: "failed", error: "too long", thrown: null });
		const failed = storyOf([...entries, { type: "thrown", error: "no outcome" }], "c1");
		expect(failed.thrown).toBe("no outcome");
	});

	it("refuses a trace that does not start with its start entry", () => {
		expect(() => storyOf([], "c1")).toThrow(/starts with its start entry/);
	});
});

describe("the page", () => {
	it("starts the viewer on its config, with the config safe inside its script element", () => {
		const page = viewerPage({
			title: "c<1> · switch",
			script: "function start() {}",
			config: { note: "</script><b>" },
		});
		expect(page).toContain("<title>c&lt;1&gt; · switch</title>");
		expect(page).toContain(
			'<script type="application/json" id="config">{"note":"\\u003c/script>\\u003cb>"}</script>',
		);
		expect(page).toContain('(() => {\nfunction start() {}\nstart(document.getElementById("app")');
		expect(JSON.parse(scriptJson({ a: "</b>" }).replace(/\\u003c/g, "<"))).toEqual({ a: "</b>" });
	});

	it("puts the parts' styles after its own, and keeps them inside the style element", () => {
		const page = viewerPage({ title: "c1", script: "", styles: ".x{color:red}</style>", config: {} });
		expect(page).toContain(".x{color:red}<\\/style></style>");
		expect(page.indexOf(".x{color:red}")).toBeGreaterThan(page.indexOf(".app{"));
	});

	it("has no style of any domain's drawing, colors or layout", () => {
		const page = viewerPage({ title: "c1", script: "", config: {} });
		// switch's word test checks the page's sources for the domains' names; a domain's own stylesheet gives its
		// drawing's size, the room for bars and the colors and stripes of its look.
		for (const rule of [
			"--stage",
			".bar-slot{min-height",
			"container-type",
			"#312E2B",
			"#81B64C",
			"--stripe",
			"--line",
		]) {
			expect(page).not.toContain(rule);
		}
		expect(page).toMatch(/\.drawing\{display:grid;gap:8px;min-width:0\}/);
	});

	it("links every case of a run from the index", () => {
		const page = indexPage("runs/a", [
			{ id: "x y", summary: "answered, 2 facts" },
			{ id: "z", summary: null },
		]);
		expect(page).toContain('<a href="/case/x%20y">x y</a> <span class="meta">answered, 2 facts</span>');
		expect(page).toContain('<a href="/case/z">z</a></li>');
		expect(escape(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
	});
});

describe("the viewer's script", () => {
	it("joins the browser modules into one script without types, imports or exports", async () => {
		const script = await viewerScript();
		expect(await viewerScript()).toBe(script);
		expect(script).not.toMatch(/^\s*(import|export)\s/m);
		expect(script).not.toMatch(/:\s*(string|number|boolean)\b[^"'`]*[,)=;]/);
		expect(() => new Script(`(() => {\n${script}\n})();`)).not.toThrow();
		const names = [...script.matchAll(/^(?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toEqual(expect.arrayContaining(["start", "registerPart", "partOf"]));
	});

	it("reads the built JavaScript next to a module that is JavaScript, and drops imports from any module", async () => {
		const folder = await mkdtemp(join(tmpdir(), "switch-script-"));
		const names = ["model", "panels", "part", "app"];
		try {
			await mkdir(join(folder, "web"));
			for (const name of names) {
				await writeFile(
					join(folder, "web", `${name}.js`),
					`import { a } from "./other.js";\nimport { b } from "../../up/other.js";\nexport function ${name}() {}\n`,
				);
			}
			const script = await buildScript(viewerModules(pathToFileURL(join(folder, "bundle.js")).href));
			expect(script).toBe(names.map((name) => `\n\nfunction ${name}() {}\n`).join("\n"));
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	});

	it("gathers each part's config by its domain's name", async () => {
		const viewer = { modules: [], config: () => Promise.resolve({ size: 1 }) };
		await expect(partConfigs({ a: viewer, b: viewer })).resolves.toEqual({ a: { size: 1 }, b: { size: 1 } });
	});

	it("joins every part's stylesheets in the order of the parts", async () => {
		const folder = await mkdtemp(join(tmpdir(), "switch-styles-"));
		try {
			await writeFile(join(folder, "a.css"), ".a{}");
			await writeFile(join(folder, "b.css"), ".b{}");
			const styled = (name: string) => ({
				modules: [],
				styles: [pathToFileURL(join(folder, `${name}.css`))],
				config: () => Promise.resolve({}),
			});
			const plainPart = { modules: [], config: () => Promise.resolve({}) };
			await expect(partStyles({ a: styled("a"), none: plainPart, b: styled("b") })).resolves.toBe(".a{}\n.b{}");
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	});
});

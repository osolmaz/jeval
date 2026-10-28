import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { run, STOP_KEY, type TraceEntry } from "@osolmaz/switch";
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
import { answering, type Facts, factsMachine, FACTS, failing, fakeDecider } from "./helpers/fakes.ts";

const facts: Facts = { facts: { a: "fact a", b: "fact <b>" } };
const opened = { looked: ["intro"], found: ["Hello"] };
const afterA = { looked: ["intro", "a"], found: ["Hello", "fact a"] };

async function traced(): Promise<TraceEntry[]> {
	let calls = 0;
	const decider = fakeDecider((request, call) => {
		calls = call;
		if (call === 2) return failing("down");
		return answering(0.7, (labels) => labels[0] ?? STOP_KEY)(request, call);
	});
	const result = await run(FACTS, factsMachine(facts, opened), decider);
	expect(calls).toBeGreaterThan(2);
	return result.trace.entries;
}

describe("storyOf", () => {
	it("reads the case's name, its domain and model, and its initial state", async () => {
		const story = storyOf(await traced(), "c1");
		expect(story).toMatchObject({ case: "c1", domain: "facts", model: "fake/decider" });
		expect(story.initial).toEqual(opened);
		expect(story.frames).toHaveLength(2);
	});

	it("reads each step: the state it picked in, every choice's probability, its pick and the state after", async () => {
		const [first] = storyOf(await traced(), "c1").frames;
		expect(first).toMatchObject({ step: 1, picked: "look-up:a", before: opened, after: afterA });
		expect(first?.choices.map((choice) => [choice.key, choice.probability, choice.picked])).toEqual([
			["look-up:a", 0.9, true],
			["look-up:b", null, false],
			["stop", null, false],
		]);
	});

	it("reads a failed pick as a step without a pick, with its note, then the answers and the end", async () => {
		const story = storyOf(await traced(), "c1");
		const second = story.frames[1];
		expect(second).toMatchObject({ step: 2, picked: null, after: null, before: afterA });
		expect(second?.notes[0]).toBe("the pick failed: down; the case goes on to its answers");
		expect(story.last).toEqual(afterA);
		expect(story.answers).toEqual({ a: { type: "bool", probability: 0.7 }, b: { type: "bool", probability: 0.7 } });
		expect(story).toMatchObject({ ended: "pick failed", error: null, thrown: null });
	});

	it("gives the notes after the steps ended to the story, also after a failed pick, and reads a failure", () => {
		const retry = "the request did not fit the model's window; trying a view of 9 tokens";
		const entries: TraceEntry[] = [
			{
				type: "start",
				domain: "facts",
				version: "1",
				definition: "d",
				case: "c1",
				model: "m",
				limits: FACTS.limits,
			},
			{ type: "state", step: 0, state: opened },
			{ type: "choices", step: 1, choices: [{ key: "stop", type: "stop", text: "Stop" }], cut: 3 },
			{ type: "note", message: "the pick failed: down; the case goes on to its answers" },
			{ type: "ended", ended: "pick failed", steps: 1 },
			{ type: "note", message: retry },
			{ type: "answers", answers: null, error: "too long" },
		];
		const story = storyOf(entries, "c1");
		expect(story.frames[0]).toMatchObject({
			cut: 3,
			notes: ["the pick failed: down; the case goes on to its answers"],
		});
		expect(story.notes).toEqual([retry]);
		expect(story).toMatchObject({ ended: "pick failed", error: "too long", answers: null, thrown: null });
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

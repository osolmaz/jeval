import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { run, STOP_KEY, type TraceEntry } from "../../src/core/index.ts";
import { buildScript, escape, indexPage, scriptJson, storyOf, viewerPage } from "../../src/view/index.ts";
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

	it("links every case of a run from the index", () => {
		const page = indexPage("runs/a", [
			{ id: "x y", outcome: "win, checkmate" },
			{ id: "z", outcome: null },
		]);
		expect(page).toContain('<a href="/case/x%20y">x y</a> <span class="meta">win, checkmate</span>');
		expect(page).toContain('<a href="/case/z">z</a></li>');
		expect(escape(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
	});
});

describe("the viewer's script", () => {
	it("joins the browser modules into one script without types, imports or exports", async () => {
		const script = await buildScript();
		expect(script).not.toMatch(/^\s*(import|export)\s/m);
		expect(script).not.toMatch(/:\s*(string|number|boolean)\b[^"'`]*[,)=;]/);
		expect(() => new Script(`(() => {\n${script}\n})();`)).not.toThrow();
		const names = [...script.matchAll(/^(?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain("start");
	});

	it("reads the built JavaScript next to a module that is JavaScript", async () => {
		const folder = await mkdtemp(join(tmpdir(), "switch-script-"));
		try {
			await mkdir(join(folder, "web"));
			for (const name of ["model", "board", "panels", "app"]) {
				await writeFile(
					join(folder, "web", `${name}.js`),
					`import { a } from "./other.js";\nexport function ${name}() {}\n`,
				);
			}
			const script = await buildScript(pathToFileURL(join(folder, "bundle.js")).href);
			expect(script).toBe(
				"\nfunction model() {}\n\n\nfunction board() {}\n\n\nfunction panels() {}\n\n\nfunction app() {}\n",
			);
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	});
});

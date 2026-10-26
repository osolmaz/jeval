import type { Answer } from "../core/index.ts";
import type { Frame, FrameOption, Seen, Story } from "./frames.ts";

/** A domain's picture of a step: the state the model chose in, with the options and their probabilities. */
export type Picture = (seen: Seen | null, options: readonly FrameOption[]) => string;

export interface PageInput {
	readonly story: Story;
	/** What the case's domain reports about how the case ended; null while it runs or when it reports nothing. */
	readonly outcome: Readonly<Record<string, unknown>> | null;
	readonly picture?: Picture | undefined;
	/** Where the page asks whether the case changed, and its version now; null for a page that never changes. */
	readonly live: { readonly url: string; readonly version: string } | null;
}

/** How many of the likeliest options a step lists; the chosen option is always listed. */
const LISTED = 10;

const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
export const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const percent = (probability: number | null): string =>
	probability === null ? "–" : `${(probability * 100).toFixed(probability < 0.001 ? 2 : 1)}%`;

/** A value from a domain's outcome as text: lists and objects become comma-separated parts. */
export function plain(value: unknown): string {
	if (Array.isArray(value)) return value.map(plain).join(", ");
	if (typeof value === "object" && value !== null) {
		return Object.entries(value)
			.map(([key, inner]) => `${key} ${plain(inner)}`)
			.join(", ");
	}
	return typeof value === "string" ? value : JSON.stringify(value);
}

function optionRow(option: FrameOption): string {
	const share = option.probability ?? 0;
	return [
		`<li${option.chosen ? ' class="chosen"' : ""}>`,
		`<span class="text">${escape(option.text)}${option.chosen ? '<span class="hidden"> (chosen)</span>' : ""}</span>`,
		`<span class="track" aria-hidden="true"><span style="--p:${share.toFixed(4)}"></span></span>`,
		`<span class="p">${percent(option.probability)}</span>`,
		"</li>",
	].join("");
}

function menuList(options: readonly FrameOption[]): string {
	const ranked = [...options].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
	const listed = ranked.filter((option, rank) => rank < LISTED || option.chosen);
	const rest = options.length - listed.length;
	const more = rest > 0 ? `<p class="more">and ${String(rest)} more options</p>` : "";
	return `<ol class="menu">${listed.map(optionRow).join("")}</ol>${more}`;
}

function seenBlock(title: string, seen: readonly Seen[]): string {
	if (seen.length === 0) return "";
	return `<h3>${escape(title)}</h3>${seen.map((item) => `<p class="found">${escape(item.text)}</p>`).join("")}`;
}

function notesBlock(notes: readonly string[]): string {
	return notes.map((note) => `<p class="notes">${escape(note)}</p>`).join("");
}

function section(id: string, label: string, picture: string, panel: string): string {
	const art = picture === "" ? "" : `<div class="picture">${picture}</div>`;
	return `<section class="frame${picture === "" ? " plain" : ""}" id="${id}" data-label="${escape(label)}" hidden>${art}<div class="panel">${panel}</div></section>`;
}

function stepSection(frame: Frame, total: number, picture: Picture | undefined): string {
	const label = `Step ${String(frame.step)} of ${String(total)}`;
	const after = frame.after === null ? [] : [frame.after];
	const panel = [
		`<h2>${label}</h2>`,
		menuList(frame.options),
		seenBlock("What the step found", after),
		notesBlock(frame.notes),
	].join("");
	return section(`step-${String(frame.step)}`, label, picture?.(frame.before, frame.options) ?? "", panel);
}

function answersBlock(answers: Readonly<Record<string, Answer>> | null): string {
	if (answers === null || Object.keys(answers).length === 0) return "";
	const rows = Object.entries(answers).map(([id, answer]) => {
		const value =
			answer.kind === "bool"
				? `yes ${percent(answer.probability)}`
				: answer.kind === "choice"
					? `${answer.choice} ${percent(answer.probabilities[answer.choice] ?? null)}`
					: `${answer.score.toFixed(2)} (confidence ${percent(answer.confidence)})`;
		return `<dt>${escape(id)}</dt><dd>${escape(value)}</dd>`;
	});
	return `<h3>Answers</h3><dl class="facts">${rows.join("")}</dl>`;
}

function endSection(input: PageInput): string {
	const { story, outcome } = input;
	const facts =
		outcome === null
			? '<p class="found">The case has no result yet.</p>'
			: `<dl class="facts">${Object.entries(outcome)
					.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(plain(value))}</dd>`)
					.join("")}</dl>`;
	const panel = `<h2>End</h2>${facts}${answersBlock(story.answers)}${notesBlock(story.notes)}`;
	return section("end", "End", input.picture?.(story.last, []) ?? "", panel);
}

function startSection(input: PageInput): string {
	const { story } = input;
	const panel = `<h2>Start</h2>${seenBlock("The case starts with", story.opening)}`;
	return section("start", "Start", input.picture?.(story.opening.at(-1) ?? null, []) ?? "", panel);
}

/** A whole page for one case: its start, every step and its end, one at a time, with controls to move through them. */
export function casePage(input: PageInput): string {
	const { story, live } = input;
	const total = story.frames.length;
	const sections = [
		startSection(input),
		...story.frames.map((frame) => stepSection(frame, total, input.picture)),
		endSection(input),
	];
	const liveData = live === null ? "" : ` data-live="${escape(live.url)}" data-version="${escape(live.version)}"`;
	const header = `<header class="top"><h1>${escape(story.case)}</h1><p class="meta">${escape(`${story.domain} · ${story.model}`)}</p></header>`;
	const controls = [
		'<nav class="controls" aria-label="Steps">',
		'<button type="button" id="prev">Previous</button>',
		'<button type="button" id="play">Play</button>',
		'<button type="button" id="next">Next</button>',
		`<input type="range" id="scrub" min="0" max="${String(sections.length - 1)}" value="0" aria-label="Step">`,
		'<output id="where" aria-live="polite"></output>',
		"</nav>",
	].join("");
	const body = `<body${liveData}>${header}${controls}<main>${sections.join("")}</main><script>${SCRIPT}</script></body>`;
	return document(`${story.case} · switch`, body);
}

/** A page that links each case of a run, with its outcome when it has one. */
export function indexPage(run: string, cases: readonly { id: string; outcome: string | null }[]): string {
	const items = cases.map(
		({ id, outcome }) =>
			`<li><a href="/case/${encodeURIComponent(id)}">${escape(id)}</a>${outcome === null ? "" : ` <span class="meta">${escape(outcome)}</span>`}</li>`,
	);
	const body = `<body><header class="top"><h1>${escape(run)}</h1></header><main class="list"><ul>${items.join("")}</ul></main></body>`;
	return document(`${run} · switch`, body);
}

function document(title: string, body: string): string {
	return [
		'<!doctype html><html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escape(title)}</title>`,
		'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
		'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">',
		`<style>${STYLE}</style></head>`,
		body,
		"</html>",
	].join("");
}

const STYLE = `
:root{--bg:#F5F0E6;--ink:#111111;--muted:#4A4A4A;--line:#D2C9B8;--panel:#FFFFFF;--track:#E3DBCB;--gutter:24px;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#000000;--ink:#F5F5F5;--muted:#BDBDBD;--line:#3A3A3A;--panel:#141414;--track:#2A2A2A;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#000000;--ink:#F5F5F5;--muted:#BDBDBD;--line:#3A3A3A;--panel:#141414;--track:#2A2A2A;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,Helvetica,Arial,"Liberation Sans",sans-serif}
.top{padding:var(--gutter) var(--gutter) 0}
h1{font-size:22px;line-height:1.2;margin:0;overflow-wrap:anywhere}
.meta{color:var(--muted);margin:4px 0 0}
.controls{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:16px var(--gutter);background:var(--bg)}
button{font:inherit;min-height:32px;padding:4px 14px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);cursor:pointer}
button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
input[type=range]{flex:1 1 180px;accent-color:var(--ink)}
output{min-width:8.5em;color:var(--muted);font-variant-numeric:tabular-nums}
.frame{display:grid;grid-template-columns:minmax(0,520px) minmax(0,1fr);gap:var(--gutter);align-items:start;padding:0 var(--gutter) var(--gutter)}
.frame.plain{grid-template-columns:minmax(0,760px)}
.frame[hidden]{display:none}
@media (max-width:860px){.frame{grid-template-columns:minmax(0,1fr)}}
.picture svg{display:block;width:100%;height:auto;color:var(--muted)}
h2{font-size:17px;line-height:1.2;margin:0 0 12px}
h3{font-size:14px;color:var(--muted);font-weight:600;margin:20px 0 6px}
.menu{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.menu li{display:grid;grid-template-columns:minmax(0,1fr) minmax(60px,120px) 4.5em;gap:10px;align-items:center}
.menu .text{overflow-wrap:anywhere}
.menu .chosen .text{font-weight:600}
.track{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.track span{display:block;height:100%;width:calc(var(--p) * 100%);background:var(--muted)}
.chosen .track span{background:var(--ink)}
.p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.more,.notes{color:var(--muted);font-size:14px;margin:8px 0 0}
.found{margin:0 0 4px}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.list{padding:16px var(--gutter)}.list li{margin:4px 0}.list a{color:var(--ink)}
`;

/** Moves through the sections; with data-live, reloads when the case changes and stays at the end if it was there. */
const SCRIPT = `
const frames = Array.from(document.querySelectorAll(".frame"));
const prev = document.getElementById("prev");
const next = document.getElementById("next");
const play = document.getElementById("play");
const scrub = document.getElementById("scrub");
const where = document.getElementById("where");
let index = 0;
let timer = null;
function show(wanted) {
	index = Math.max(0, Math.min(frames.length - 1, wanted));
	frames.forEach((frame, at) => { frame.hidden = at !== index; });
	scrub.value = String(index);
	where.textContent = frames[index].dataset.label;
	history.replaceState(null, "", "#" + frames[index].id);
}
function stop() { clearInterval(timer); timer = null; play.textContent = "Play"; }
function start() {
	if (index === frames.length - 1) show(0);
	play.textContent = "Pause";
	timer = setInterval(() => { if (index >= frames.length - 1) stop(); else show(index + 1); }, 1000);
}
prev.addEventListener("click", () => { stop(); show(index - 1); });
next.addEventListener("click", () => { stop(); show(index + 1); });
play.addEventListener("click", () => { if (timer === null) start(); else stop(); });
scrub.addEventListener("input", () => { stop(); show(Number(scrub.value)); });
document.addEventListener("keydown", (event) => {
	if (event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
	if (event.key === "ArrowLeft") { stop(); show(index - 1); }
	if (event.key === "ArrowRight") { stop(); show(index + 1); }
	if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
		event.preventDefault();
		if (timer === null) start(); else stop();
	}
});
const asked = location.hash === "#latest" ? frames.length - 1 : frames.findIndex((frame) => "#" + frame.id === location.hash);
show(asked >= 0 ? asked : 0);
const live = document.body.dataset.live;
if (live) {
	const version = document.body.dataset.version;
	setInterval(async () => {
		try {
			const response = await fetch(live, { cache: "no-store" });
			if (!response.ok || (await response.text()) === version) return;
			if (index === frames.length - 1) history.replaceState(null, "", "#latest");
			location.reload();
		} catch {}
	}, 1000);
}
`;

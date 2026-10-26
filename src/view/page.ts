const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
export const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** JSON that is safe inside a script element: no `<`, so no `</script>`. */
export const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

export interface ViewerPage {
	readonly title: string;
	/** The viewer's script, from `viewerScript`. */
	readonly script: string;
	/** What the viewer starts with: its session or where to fetch it, and the piece images. */
	readonly config: Readonly<Record<string, unknown>>;
}

/** A case's page: the viewer's script, started on `config`. It needs nothing else when the session is in it. */
export function viewerPage(page: ViewerPage): string {
	const boot = 'start(document.getElementById("app"), JSON.parse(document.getElementById("config").textContent));';
	return document(
		page.title,
		[
			'<body><div id="app"></div>',
			`<script type="application/json" id="config">${scriptJson(page.config)}</script>`,
			`<script>(() => {\n${page.script}\n${boot}\n})();</script>`,
			"</body>",
		].join(""),
	);
}

/** A page that links each case of a run, with its outcome when it has one. */
export function indexPage(run: string, cases: readonly { id: string; outcome: string | null }[]): string {
	const items = cases.map(
		({ id, outcome }) =>
			`<li><a href="/case/${encodeURIComponent(id)}">${escape(id)}</a>${outcome === null ? "" : ` <span class="meta">${escape(outcome)}</span>`}</li>`,
	);
	const body = `<body><div class="app"><header class="bar"><span class="brand">switch</span><h1>${escape(run)}</h1></header><ul class="list">${items.join("")}</ul></div></body>`;
	return document(`${run} · switch`, body);
}

function document(title: string, body: string): string {
	return [
		'<!doctype html><html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escape(title)}</title>`,
		'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
		'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
		`<style>${STYLE}</style></head>`,
		body,
		"</html>",
	].join("");
}

const STYLE = `
:root{--bg:#F5F0E6;--ink:#111111;--muted:#4A4A4A;--quiet:#7A705F;--line:#D9D0BF;--panel:#FFFFFF;--track:#E6DECE;--light:#F0E6D2;--dark:#B8A383;--gutter:24px;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#000000;--ink:#F5F5F5;--muted:#BDBDBD;--quiet:#8F8F8F;--line:#2E2E2E;--panel:#121212;--track:#2A2A2A;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#000000;--ink:#F5F5F5;--muted:#BDBDBD;--quiet:#8F8F8F;--line:#2E2E2E;--panel:#121212;--track:#2A2A2A;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Inter,Helvetica,Arial,"Liberation Sans",sans-serif}
.app{max-width:1240px;margin:0 auto;padding:var(--gutter)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:20px}
.brand{font-weight:600;letter-spacing:-0.01em}
.bar h1{font-size:18px;line-height:1.2;font-weight:600;margin:0;overflow-wrap:anywhere}
.meta{color:var(--muted)}
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C2410C}
.live::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.spacer{flex:1}
button,select,.download{font:inherit;min-height:34px;padding:4px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.layout{display:grid;grid-template-columns:minmax(0,640px) minmax(280px,1fr);gap:32px;align-items:start}
@media (max-width:920px){.layout{grid-template-columns:minmax(0,1fr)}}
.stage{display:grid;gap:10px}
.player-slot{min-height:28px}
.player{display:flex;align-items:center;gap:10px;min-height:28px}
.swatch{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--ink)}
.swatch.w{background:#FFFFFF}.swatch.b{background:#111111}
.name{font-weight:600;overflow-wrap:anywhere}
.taken{display:flex;align-items:center}
.taken img{width:22px;height:22px;margin-right:-7px}
.lead{color:var(--muted);font-variant-numeric:tabular-nums;margin-left:6px}
.board{position:relative;width:100%;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid var(--line);user-select:none}
.squares{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr)}
.square{position:relative}
.square.light{background:var(--light)}.square.dark{background:var(--dark)}
.square span{position:absolute;font-size:clamp(9px,1.6vw,12px);font-weight:600;line-height:1}
.square .rank{top:4px;left:4px}.square .file{bottom:3px;right:4px}
.square.light span{color:var(--dark)}.square.dark span{color:var(--light)}
.marks,.pieces{position:absolute;inset:0;pointer-events:none}
.mark,.piece{position:absolute;left:0;top:0;width:12.5%;height:12.5%;transform:translate(calc(var(--x) * 100%),calc(var(--y) * 100%))}
.mark.last{background:rgba(205,170,40,.38)}
.mark.check{background:rgba(214,40,40,.32);box-shadow:inset 0 0 0 3px rgba(214,40,40,.85)}
.piece{background-position:center;background-repeat:no-repeat;background-size:86%;transition:transform var(--motion,320ms) ease,opacity var(--motion,320ms) ease}
.piece.taken{opacity:0}
.arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.arrow{fill:#4E4636;fill-opacity:.38}
.arrow.chosen{fill:#14110C;fill-opacity:.78}
.found-card{min-height:240px;padding:20px;border:1px solid var(--line);border-radius:8px;background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere}
.controls{display:grid;gap:10px;margin-top:6px}
.buttons{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.buttons button{min-width:40px;justify-content:center}
.buttons .play{min-width:84px;font-weight:600}
input[type=range]{width:100%;margin:0;accent-color:var(--ink)}
output{min-width:8.5em;color:var(--muted);font-variant-numeric:tabular-nums}
.speed{display:inline-flex;align-items:center;gap:6px;color:var(--muted)}
.side{display:grid;gap:24px;min-width:0}
.side-slot{display:grid;gap:24px}
.side h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 10px}
.menu{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.menu li{display:grid;grid-template-columns:minmax(0,1fr) minmax(48px,96px) 4.2em;gap:10px;align-items:center}
.menu .text{overflow-wrap:anywhere}
.menu .chosen .text{font-weight:600}
.track{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.track span{display:block;height:100%;width:calc(var(--p) * 100%);background:var(--quiet)}
.chosen .track span{background:var(--ink)}
.p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.quiet{color:var(--muted);font-size:14px;margin:8px 0 0}
.found{margin:0}
.side h3{font-size:13px;font-weight:600;color:var(--muted);margin:16px 0 4px}
.headline{font-size:20px;font-weight:600;margin:0 0 8px}
.headline::first-letter{text-transform:uppercase}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.spark svg{display:block;width:100%;height:64px}
.spark polyline{fill:none;stroke:var(--ink);stroke-width:1.5;vector-effect:non-scaling-stroke}
.spark .mid{stroke:var(--line);vector-effect:non-scaling-stroke}
.spark .now{stroke:var(--quiet);stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.plies{list-style:none;margin:0;padding:0;display:grid;gap:2px;max-height:340px;overflow:auto}
.plies li{display:grid;grid-template-columns:3em minmax(0,1fr) minmax(0,1fr);align-items:center;gap:4px}
.plies .number{color:var(--muted);font-variant-numeric:tabular-nums}
.ply{min-height:28px;padding:2px 8px;border:0;border-radius:6px;background:transparent;justify-content:flex-start;gap:8px}
.ply small{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.ply.current{background:var(--ink);color:var(--bg)}
.ply.current small{color:inherit}
.hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.list{list-style:none;padding:0;margin:0;display:grid;gap:6px}.list a{color:var(--ink);font-weight:600}
@media (prefers-reduced-motion:reduce){.piece{transition:none}}
`;

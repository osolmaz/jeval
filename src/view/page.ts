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
	/** What the viewer starts with: its session or where to fetch it, and the config of each domain's part. */
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
		`<style>${STYLE}</style></head>`,
		body,
		"</html>",
	].join("");
}

const STYLE = `
:root{--bg:#312E2B;--panel:#262522;--stripe:#2B2926;--raise:#3C3A37;--line:#3F3D3A;--ink:#FFFFFF;--text:#E8E6E3;--muted:#A3A19E;--faint:#77756F;--accent:#81B64C;--accent-edge:#45753C;--light:#EBECD0;--dark:#739552;--gutter:20px;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.app{max-width:1600px;margin:0 auto;padding:var(--gutter)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:16px}
.home{display:inline-flex;align-items:center;gap:14px;color:inherit;text-decoration:none}
a.home[href]:hover h1{text-decoration:underline}
.brand{font-weight:800;font-size:18px;letter-spacing:-0.02em;color:var(--accent)}
.bar h1{font-size:17px;line-height:1.2;font-weight:700;margin:0;color:var(--ink);overflow-wrap:anywhere}
.meta{color:var(--muted)}
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#FA412D}
.live::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.spacer{flex:1}
button,select,.download{font:inherit;font-weight:600;min-height:36px;padding:4px 14px;border:0;border-radius:6px;background:var(--raise);color:var(--text);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.28)}
button:hover,select:hover,.download:hover{background:#4A4744}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.layout{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;justify-content:center;align-items:start}
.stage{display:grid;gap:8px;width:min(100%,max(280px,100dvh - 200px));justify-self:center}
.player-slot{min-height:44px}
.player{display:flex;align-items:center;gap:10px;min-height:44px}
.avatar{width:40px;height:40px;padding:3px;border-radius:4px;background:var(--raise)}
.who{display:grid;gap:2px;flex:1;min-width:0}
.name{font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.taken{display:flex;align-items:center;min-height:18px}
.taken img{width:18px;height:18px;margin-right:-6px}
.lead{margin-left:10px;font-size:13px;font-weight:600;color:var(--muted)}
.clock{min-width:96px;padding:6px 12px;border-radius:4px;font-weight:700;text-align:right;opacity:.5}
.clock.w{background:#FFFFFF;color:#262421}.clock.b{background:#1C1B19;color:#FFFFFF}
.clock.active{opacity:1}
.board{position:relative;width:100%;aspect-ratio:1;border-radius:4px;overflow:hidden;user-select:none}
.squares{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr)}
.square{position:relative}
.square.light{background:var(--light)}.square.dark{background:var(--dark)}
.square span{position:absolute;font-size:clamp(10px,1.7vw,14px);font-weight:700;line-height:1}
.square .rank{top:4px;left:4px}.square .file{bottom:4px;right:5px}
.square.light span{color:var(--dark)}.square.dark span{color:var(--light)}
.marks,.pieces{position:absolute;inset:0;pointer-events:none}
.mark,.piece{position:absolute;left:0;top:0;width:12.5%;height:12.5%;transform:translate(calc(var(--x) * 100%),calc(var(--y) * 100%))}
.mark.last{background:rgba(255,255,51,.5)}
.mark.check{background:radial-gradient(circle,rgba(255,0,0,.9) 0,rgba(231,0,0,.55) 35%,rgba(169,0,0,0) 72%)}
.piece{background-position:center;background-repeat:no-repeat;background-size:88%;transition:transform var(--motion,320ms) ease,opacity var(--motion,320ms) ease}
.piece.taken{opacity:0}
.arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.arrow{fill:#FFAA00;fill-opacity:.38}
.arrow.chosen{fill:#FFAA00;fill-opacity:.9}
.found-card{min-height:240px;padding:20px;border-radius:8px;background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere}
.side{display:grid;gap:16px;min-width:0}
.card{padding:14px 16px;border-radius:8px;background:var(--panel)}
.side h2{font-size:14px;font-weight:700;color:var(--ink);margin:0 0 10px}
.side h3{font-size:13px;font-weight:700;color:var(--muted);margin:16px 0 4px}
.step{font-size:13px;color:var(--muted);margin:-6px 0 12px}
.menu{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.menu li{display:grid;grid-template-columns:minmax(0,1fr) minmax(48px,90px) 4.2em;gap:10px;align-items:center;font-size:14px}
.menu .text{overflow-wrap:anywhere}
.menu .chosen .text{font-weight:700;color:var(--ink)}
.track{height:8px;border-radius:4px;background:#403D39;overflow:hidden}
.track span{display:block;height:100%;width:calc(var(--p) * 100%);background:#8B8987}
.chosen .track span{background:var(--accent)}
.p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.quiet{font-size:14px;color:var(--muted);margin:8px 0 0}
.found{margin:0}
.spark svg{display:block;width:100%;height:72px;border-radius:4px;background:#403D39}
.spark polygon{fill:#FFFFFF;fill-opacity:.88}
.spark .mid{stroke:#77756F;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
.spark .now{stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}
.history{display:grid;gap:10px}
.history h2{margin:0}
.plies{list-style:none;margin:0 -16px;padding:0;max-height:360px;overflow:auto}
.plies li{display:grid;grid-template-columns:3.2em minmax(0,1fr) minmax(0,1fr);align-items:center;gap:4px;min-height:30px;padding:0 16px}
.plies li:nth-child(even){background:var(--stripe)}
.plies .number{font-size:13px;font-weight:600;color:var(--faint)}
.ply{min-height:26px;padding:2px 8px;border-radius:3px;background:transparent;box-shadow:none;justify-content:flex-start;gap:6px;color:var(--text)}
.ply:hover{background:var(--raise)}
.ply.empty{color:var(--faint)}
.ply .san{display:inline-flex;align-items:center;font-weight:600}
.figure{width:20px;height:20px;margin-right:1px}
.ply small{font-size:11px;font-weight:600;color:var(--faint)}
.ply.current{background:#4B4847;color:var(--ink);box-shadow:inset 0 -2px 0 rgba(0,0,0,.3)}
.ply.current small{color:var(--muted)}
.banner{display:flex;align-items:baseline;gap:10px;margin:0 0 8px;font-size:16px;color:var(--ink)}
.banner strong{font-size:20px}
.banner span::first-letter{text-transform:uppercase}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0;font-size:14px}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.controls{display:grid;gap:10px}
input[type=range]{width:100%;margin:0;accent-color:var(--accent)}
.buttons{display:flex;gap:6px}
.buttons button{flex:1;min-width:0;font-size:16px}
.buttons .play{flex:2;font-size:15px;background:var(--accent);color:#FFFFFF;box-shadow:inset 0 -3px 0 var(--accent-edge)}
.buttons .play:hover{background:#95C25A}
.status{display:flex;align-items:center;gap:8px}
output{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.speed{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.speed select{min-height:30px;padding:2px 8px}
.hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.list{list-style:none;padding:0;margin:0;display:grid;gap:6px}.list a{color:var(--ink);font-weight:700}
@media (prefers-reduced-motion:reduce){.piece{transition:none}}
@media (min-width:981px){
.app{min-height:100dvh;display:flex;flex-direction:column}
.layout{flex:1 1 0;min-height:0;container-type:size;grid-template-columns:auto 380px;--board:max(240px,min(100cqw - 404px,100cqh - 104px))}
.stage{width:var(--board)}
.found-card{max-height:var(--board);overflow:auto}
.side{display:flex;flex-direction:column;height:calc(var(--board) + 104px)}
.chart{flex:none}
.side-slot{flex:0 1 auto;min-height:0;overflow:auto}
.history{flex:1 1 auto;display:flex;flex-direction:column}
.moves{flex:1 1 0;min-height:64px;display:flex;flex-direction:column}
.plies{flex:1 1 0;min-height:0;max-height:none}
}
`;

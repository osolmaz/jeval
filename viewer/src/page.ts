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
	/** The styles of the domains' parts, which come after the page's own. */
	readonly styles?: string;
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
		page.styles ?? "",
	);
}

/** A page that links each case of a run, with the summary of how it ended when its domain gives one. */
export function indexPage(run: string, cases: readonly { id: string; summary: string | null }[]): string {
	const items = cases.map(
		({ id, summary }) =>
			`<li><a href="/case/${encodeURIComponent(id)}">${escape(id)}</a>${summary === null ? "" : ` <span class="meta">${escape(summary)}</span>`}</li>`,
	);
	const body = `<body><div class="app"><header class="bar"><span class="brand">switch</span><h1>${escape(run)}</h1></header><ul class="list">${items.join("")}</ul></div></body>`;
	return document(`${run} · switch`, body);
}

function document(title: string, body: string, styles = ""): string {
	return [
		'<!doctype html><html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escape(title)}</title>`,
		`<style>${STYLE}${styles.replace(/<\//g, "<\\/")}</style></head>`,
		body,
		"</html>",
	].join("");
}

const STYLE = `
:root{--bg:#1C1D21;--panel:#25272C;--stripe:#212328;--raise:#32353C;--raise-hover:#3D4048;--line:#383B42;--ink:#FFFFFF;--text:#E4E5E8;--muted:#9EA1A8;--faint:#71747B;--accent:#5B8DEF;--accent-edge:#3D68C4;--accent-hover:#7AA3F2;--live:#E5484D;--track:#383B42;--bar:#8A8D94;--chart:#5B8DEF;--gutter:20px;color-scheme:dark}
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
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--live)}
.live::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.spacer{flex:1}
button,select,.download{font:inherit;font-weight:600;min-height:36px;padding:4px 14px;border:0;border-radius:6px;background:var(--raise);color:var(--text);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.28)}
button:hover,select:hover,.download:hover{background:var(--raise-hover)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.layout{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start}
.stage{display:grid;gap:8px;min-width:0}
.state-card{min-height:240px;padding:20px;border-radius:8px;background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere}
.side{display:grid;gap:16px;min-width:0}
.card{padding:14px 16px;border-radius:8px;background:var(--panel)}
.side h2{font-size:14px;font-weight:700;color:var(--ink);margin:0 0 10px}
.side h3{font-size:13px;font-weight:700;color:var(--muted);margin:16px 0 4px}
.step{font-size:13px;color:var(--muted);margin:-6px 0 12px}
.choices{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.choices li{display:grid;grid-template-columns:minmax(0,1fr) minmax(48px,90px) 4.2em;gap:10px;align-items:center;font-size:14px}
.choices .text{overflow-wrap:anywhere}
.choices .picked .text{font-weight:700;color:var(--ink)}
.track{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.track span{display:block;height:100%;width:calc(var(--p) * 100%);background:var(--bar)}
.picked .track span{background:var(--accent)}
.p{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.quiet{font-size:14px;color:var(--muted);margin:8px 0 0}
.change{margin:0}
.spark svg{display:block;width:100%;height:72px;border-radius:4px;background:var(--track)}
.spark polygon{fill:var(--chart);fill-opacity:.88}
.spark .mid{stroke:var(--faint);stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
.spark .now{stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}
.timeline{display:grid;gap:10px}
.timeline h2{margin:0}
.banner{margin:0 0 8px;font-size:16px;color:var(--ink)}
.banner::first-letter{text-transform:uppercase}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0;font-size:14px}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.controls{display:grid;gap:10px}
input[type=range]{width:100%;margin:0;accent-color:var(--accent)}
.buttons{display:flex;gap:6px}
.buttons button{flex:1;min-width:0;font-size:16px}
.buttons .play{flex:2;font-size:15px;background:var(--accent);color:#FFFFFF;box-shadow:inset 0 -3px 0 var(--accent-edge)}
.buttons .play:hover{background:var(--accent-hover)}
.status{display:flex;align-items:center;gap:8px}
output{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.speed{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.speed select{min-height:30px;padding:2px 8px}
.hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.list{list-style:none;padding:0;margin:0;display:grid;gap:6px}.list a{color:var(--ink);font-weight:700}
@media (min-width:981px){
.app{min-height:100dvh;display:flex;flex-direction:column}
.layout{flex:1 1 0;min-height:0;grid-template-columns:minmax(0,1fr) 380px}
.state-card{max-height:calc(100dvh - 110px);overflow:auto}
.side{display:flex;flex-direction:column;height:calc(100dvh - 110px)}
.chart{flex:none}
.side-slot{flex:0 1 auto;min-height:0;overflow:auto}
.timeline{flex:1 1 auto;display:flex;flex-direction:column}
.steps{flex:1 1 0;min-height:64px;display:flex;flex-direction:column}
}
`;

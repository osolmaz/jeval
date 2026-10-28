import { describe, expect, it } from "vitest";
import { articleOf, linksIn, WikiError, wikipedia } from "../src/wiki.ts";

const anchor = (href: string, text = "x") => `<a href="/wiki/${href}" title="${text}">${text}</a>`;
const heading = (id: string, text: string) =>
	`<div class="mw-heading mw-heading2"><h2 id="${id}">${text}</h2><span class="mw-editsection"></span></div>`;

const HTML = [
	'<div class="mw-parser-output"><div role="note" class="hatnote">',
	anchor("Duck_(disambiguation)"),
	"</div><p>",
	anchor("Bird"),
	anchor("File:Duck.jpg"),
	anchor("Water%20fowl"),
	anchor("Bird"),
	anchor("Duck"),
	anchor("Bird#Wings"),
	`<a class="mw-redirect" href="/wiki/Pond" title="Pond">pond</a>`,
	"</p>",
	heading("History", "History &amp; culture"),
	`<p>${anchor("Rubber_duck")}${anchor("Category:Birds")}${anchor("Bad%E0%A4%A")}</p>`,
	heading("Gallery", "Gallery"),
	"<p>No links here.</p>",
	heading("References", "References"),
	`<p>${anchor("Journal_of_birds")}</p>`,
	heading("General_and_cited_sources", "General and cited sources"),
	`<p>${anchor("Some_book")}</p>`,
	"</div>",
].join("");

describe("articleOf", () => {
	it("gives the links of each section in order, each once, without the pages that are not articles", () => {
		expect(articleOf("Duck", HTML)).toEqual({
			title: "Duck",
			sections: [
				{ name: "Lead", links: ["Bird", "Water fowl", "Pond"] },
				{ name: "History & culture", links: ["Rubber duck"] },
			],
		});
	});

	it("leaves out the article itself, and a link that cannot be decoded", () => {
		expect(linksIn(`${anchor("Duck")}${anchor("Bad%E0%A4%A")}${anchor("Goose")}`, "Duck")).toEqual(["Goose"]);
	});
});

/** A fetch that answers each request with `body`, and keeps the URLs and headers it was asked with. */
function fakeFetch(body: unknown, status = 200) {
	const asked: { url: string; agent: string | null }[] = [];
	const get = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const address = url instanceof Request ? url.url : url.toString();
		asked.push({ url: address, agent: new Headers(init?.headers).get("user-agent") });
		return Promise.resolve(Response.json(body, { status }));
	};
	return { get, asked };
}

describe("wikipedia", () => {
	it("reads an article through the API, after redirects, and names itself", async () => {
		const api = fakeFetch({ parse: { title: "Duck", text: HTML } });
		const article = await wikipedia(api.get).article("Ducks");
		expect(article.title).toBe("Duck");
		const [request] = api.asked;
		const url = new URL(request?.url ?? "");
		expect(url.origin + url.pathname).toBe("https://en.wikipedia.org/w/api.php");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			action: "parse",
			page: "Ducks",
			prop: "text",
			redirects: "1",
			format: "json",
			formatversion: "2",
		});
		expect(request?.agent).toMatch(/^switch-wikirace-example\//);
	});

	it("reads the target's title and first sentences", async () => {
		const api = fakeFetch({ query: { pages: [{ title: "Moon", extract: "The Moon orbits Earth." }] } });
		await expect(wikipedia(api.get).summary("moon")).resolves.toEqual({
			title: "Moon",
			summary: "The Moon orbits Earth.",
		});
		const noText = fakeFetch({ query: { pages: [{ title: "Moon" }] } });
		await expect(wikipedia(noText.get).summary("Moon")).resolves.toEqual({ title: "Moon", summary: "" });
	});

	it("fails with a WikiError for a missing article, a missing target and a failed request", async () => {
		const missing = fakeFetch({ error: { info: "The page you specified doesn't exist." } });
		await expect(wikipedia(missing.get).article("Nope")).rejects.toThrow(
			'Wikipedia has no article "Nope": The page you specified doesn\'t exist.',
		);
		const noTarget = fakeFetch({ query: { pages: [{ title: "Nope", missing: true }] } });
		await expect(wikipedia(noTarget.get).summary("Nope")).rejects.toThrow(WikiError);
		const down = fakeFetch({}, 503);
		await expect(wikipedia(down.get).article("Duck")).rejects.toThrow("Wikipedia answered 503 for Duck");
		await expect(wikipedia(down.get).summary("Moon")).rejects.toThrow("Wikipedia answered 503 for Moon");
	});
});

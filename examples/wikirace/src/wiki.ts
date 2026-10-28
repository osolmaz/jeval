import type { JsonObject } from "@osolmaz/switch";
import { z } from "zod";

/** One section of an article: its heading, or "Lead" for the text before the first heading, and its links in order. */
export interface Section extends JsonObject {
	readonly name: string;
	readonly links: readonly string[];
}

/** An article as the race sees it: its title after redirects, and its links by section. */
export interface Article {
	readonly title: string;
	readonly sections: readonly Section[];
}

/** Where the race reads Wikipedia: an article's links, and the first sentences of the target. */
export interface Wiki {
	article(title: string): Promise<Article>;
	summary(title: string): Promise<{ readonly title: string; readonly summary: string }>;
}

/** Wikipedia could not give an article. */
export class WikiError extends Error {
	override readonly name = "WikiError";
}

/** Titles of pages that are not articles: files, help, categories, templates and the like. */
const NOT_ARTICLES =
	/^(File|Image|Media|Help|Special|Category|Wikipedia|WP|Template|Template talk|Portal|Talk|Module|Draft|MediaWiki|User|User talk|Book|TimedText|Wikt|Wiktionary):/i;

/** Headings of sections that list sources or other sites, whose links lead away from the subject. */
const SOURCE_SECTIONS =
	/\b(references|citations|sources|bibliography|footnotes|works cited)\b|^(notes|further reading|external links)$/i;
/** The end of the title of a page that only lists the articles of one name, which hatnotes link to. */
const DISAMBIGUATION = "(disambiguation)";

const HEADING = /<div class="mw-heading mw-heading2">/;
const LINK = /<a\b[^>]*?\bhref="\/wiki\/([^"#?]+)/g;
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** HTML text without its tags and with its common entities decoded. */
const plain = (html: string): string =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
		.trim();

/**
 * A link target as a title: decoded, with spaces for underscores; null for a page that is not an article, or that only
 * lists the articles of one name.
 */
function titleOf(href: string): string | null {
	try {
		const title = decodeURIComponent(href).replaceAll("_", " ");
		return NOT_ARTICLES.test(title) || title.endsWith(DISAMBIGUATION) ? null : title;
	} catch {
		return null;
	}
}

/** The article titles that `html` links to, each once, in the order of their first link. */
export function linksIn(html: string, self: string): string[] {
	const links = new Set<string>();
	for (const match of html.matchAll(LINK)) {
		const title = titleOf(match[1] ?? "");
		if (title !== null && title !== self) links.add(title);
	}
	return [...links];
}

/**
 * The article `title` with the parsed HTML `html`, as sections of links: the lead, then each top-level section in
 * order, without the sections that list sources and without sections that have no links.
 */
export function articleOf(title: string, html: string): Article {
	const [lead = "", ...rest] = html.split(HEADING);
	const sections: Section[] = [{ name: "Lead", links: linksIn(lead, title) }];
	for (const part of rest) {
		const name = plain(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(part)?.[1] ?? "");
		if (!SOURCE_SECTIONS.test(name)) sections.push({ name, links: linksIn(part, title) });
	}
	return { title, sections: sections.filter((section) => section.links.length > 0) };
}

/** Wikipedia's API, which asks clients to name themselves. */
const API = "https://en.wikipedia.org/w/api.php";
const AGENT = "switch-wikirace-example/0.1 (https://github.com/osolmaz/switch)";

const errorSchema = z.object({ error: z.object({ info: z.string() }) });
const parseSchema = z.union([z.object({ parse: z.object({ title: z.string(), text: z.string() }) }), errorSchema]);
const querySchema = z.object({
	query: z.object({
		pages: z.array(z.object({ title: z.string(), missing: z.boolean().optional(), extract: z.string().optional() })),
	}),
});

/** English Wikipedia, read through its API with `get`: the latest version of each article, with redirects followed. */
export function wikipedia(get: typeof fetch = fetch): Wiki {
	const call = async (params: Readonly<Record<string, string>>): Promise<unknown> => {
		const query = new URLSearchParams({ ...params, redirects: "1", format: "json", formatversion: "2" });
		const response = await get(`${API}?${query.toString()}`, { headers: { "user-agent": AGENT } });
		if (!response.ok)
			throw new WikiError(
				`Wikipedia answered ${String(response.status)} for ${params["page"] ?? params["titles"] ?? ""}`,
			);
		return response.json();
	};
	return {
		async article(title) {
			const body = parseSchema.parse(await call({ action: "parse", page: title, prop: "text" }));
			if ("error" in body) throw new WikiError(`Wikipedia has no article "${title}": ${body.error.info}`);
			return articleOf(body.parse.title, body.parse.text);
		},
		async summary(title) {
			const params = {
				action: "query",
				titles: title,
				prop: "extracts",
				exintro: "1",
				explaintext: "1",
				exsentences: "2",
			};
			const [page] = querySchema.parse(await call(params)).query.pages;
			if (page === undefined || page.missing === true) throw new WikiError(`Wikipedia has no article "${title}"`);
			return { title: page.title, summary: page.extract ?? "" };
		},
	};
}

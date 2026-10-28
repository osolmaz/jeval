import { type Article, type Wiki, WikiError } from "../../src/wiki.ts";

/** Articles by title: each with its links by section name, in order. */
export type Pages = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

/**
 * A wiki of `pages`, with `redirects` from other titles to theirs, that counts the articles it is asked for. Every
 * article's summary is "About <title>."
 */
export function fakeWiki(
	pages: Pages,
	redirects: Readonly<Record<string, string>> = {},
): Wiki & { readonly asked: string[] } {
	const asked: string[] = [];
	const titleOf = (title: string): string => redirects[title] ?? title;
	return {
		asked,
		article(title) {
			asked.push(title);
			const found = pages[titleOf(title)];
			if (found === undefined) return Promise.reject(new WikiError(`no article ${title}`));
			const article: Article = {
				title: titleOf(title),
				sections: Object.entries(found).map(([name, links]) => ({ name, links })),
			};
			return Promise.resolve(article);
		},
		summary: (title) => Promise.resolve({ title: titleOf(title), summary: `About ${titleOf(title)}.` }),
	};
}

/** A small world of articles: from Duck, the way to Moon goes through Bird and Sky, or through Astronomy. */
export const PAGES: Pages = {
	Duck: { Lead: ["Bird", "Water", "Pond"], Culture: ["Rubber duck"] },
	Bird: { Lead: ["Duck", "Sky", "Feather"] },
	Sky: { Lead: ["Moon", "Sun", "Cloud"] },
	Water: { Lead: ["Pond"] },
	Pond: { Lead: [] },
	Moon: { Lead: ["Earth"] },
};

/** `count` article titles, Link 1 to Link `count`. */
export const manyLinks = (count: number, prefix = "Link"): string[] =>
	Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1)}`);

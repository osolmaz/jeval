import { type DomainViewer, modulesNear } from "@osolmaz/switch-viewer";

/**
 * The wikirace part of the viewer: the route of the articles toward the target, the branches of each step with the
 * model's probabilities, and the list of the steps, with styles that look like Wikipedia.
 */
export const wikiraceViewer: DomainViewer = {
	modules: modulesNear(import.meta.url, "./web", ["data", "route", "part"]),
	styles: [new URL("./web/wikirace.css", import.meta.url)],
	summary: ({ result, hops }) =>
		[result, typeof hops === "number" ? `${String(hops)} hops` : null]
			.filter((part) => typeof part === "string")
			.join(" · "),
	config: () => Promise.resolve({}),
};

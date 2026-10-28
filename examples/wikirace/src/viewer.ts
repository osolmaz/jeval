import { type DomainViewer, modulesNear } from "@osolmaz/switch-viewer";

/** The wikirace part of the viewer: the trail of articles toward the target, with its styles. */
export const wikiraceViewer: DomainViewer = {
	modules: modulesNear(import.meta.url, "./web", ["part"]),
	styles: [new URL("./web/wikirace.css", import.meta.url)],
	summary: ({ result, hops }) =>
		[result, typeof hops === "number" ? `${String(hops)} hops` : null]
			.filter((part) => typeof part === "string")
			.join(" · "),
	config: () => Promise.resolve({}),
};

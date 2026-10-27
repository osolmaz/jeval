/**
 * What a domain's part of the page takes from switch's page: its types, its helpers and `registerPart`. In the page's
 * one script these names are in scope, so the script drops every import of this module.
 */
export type { Frame, FrameChoice, Seen, Story } from "../frames.ts";
export { App, type AppConfig, start } from "./app.ts";
export { answerText, confidence, type Moment, momentsOf, percent, plain, ranked, type Session } from "./model.ts";
export { button, type Child, h } from "./panels.ts";
export {
	type Download,
	type DomainPart,
	type PartContext,
	type PartMaker,
	partOf,
	type PartSound,
	registerPart,
} from "./part.ts";

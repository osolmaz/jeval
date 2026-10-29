import { createHash } from "node:crypto";
import type { Definition, Domain, JsonObject, Limits } from "./types.ts";

/** The SHA-256 of a value as JSON, in hex. */
export const hashOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const definitionOf = (name: string, content: JsonObject): Definition => ({
	name,
	hash: hashOf(content),
	content,
});

/** The limits as JSON: without a step limit when they have none. */
export const limitsJson = ({ steps, windowShare }: Limits): JsonObject =>
	steps === undefined ? { windowShare } : { steps, windowShare };

/** A domain's definition: its own, or by default its limits. */
export const definitionFor = (domain: Pick<Domain<JsonObject>, "name" | "limits" | "definition">): Definition =>
	domain.definition ?? definitionOf(domain.name, { limits: limitsJson(domain.limits) });

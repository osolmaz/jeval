import { createHash } from "node:crypto";
import type { Definition, Domain, JsonObject } from "./types.ts";

/** The SHA-256 of a value as JSON, in hex. */
export const hashOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const definitionOf = (name: string, content: JsonObject): Definition => ({
	name,
	hash: hashOf(content),
	content,
});

/** A domain's definition: its own, or by default its stop text, its instructions and its limits. */
export const definitionFor = (
	domain: Pick<Domain<JsonObject>, "name" | "stop" | "instructions" | "limits" | "definition">,
): Definition =>
	domain.definition ??
	definitionOf(domain.name, { stop: domain.stop, instructions: domain.instructions, limits: { ...domain.limits } });

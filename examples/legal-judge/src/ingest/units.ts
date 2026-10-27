import type { Unit } from "../case.ts";

/** Text as one unit, or as groups of `size` lines when it is longer. */
export function textUnits(text: string, label = "lines", size = 60): Unit[] {
	const lines = text.split("\n");
	if (lines.length <= size) return [{ label: "all", text }];
	const units: Unit[] = [];
	for (let start = 0; start < lines.length; start += size) {
		const end = Math.min(start + size, lines.length);
		units.push({ label: `${label} ${String(start + 1)}-${String(end)}`, text: lines.slice(start, end).join("\n") });
	}
	return units;
}

export const countWords = (units: readonly Unit[]): number =>
	units.reduce((sum, unit) => sum + unit.text.split(/\s+/).filter(Boolean).length, 0);

/** Visible text of an HTML page: scripts and styles dropped, block ends as line breaks, entities decoded. */
export function htmlText(html: string): string {
	const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (match, name: string) => decodeEntity(name, entities) ?? match);
}

function decodeEntity(name: string, entities: Readonly<Record<string, string>>): string | undefined {
	if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
	if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
	return entities[name.toLowerCase()];
}

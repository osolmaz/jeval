import type { JudgeDefinition } from "./definition.ts";

/**
 * An item passes only when every question that counts for it says yes and every question that counts against it says
 * no: its probability is the smallest of P(yes) for the first sort and 1 - P(yes) for the second. A check without an
 * answer counts as a no.
 */
export function combine(definition: JudgeDefinition, item: string, checks: Readonly<Record<string, number>>): number {
	const parts = definition.questions.map((question) => {
		const yes = checks[`${item}/${question.id}`] ?? 0;
		return question.counts === "for" ? yes : 1 - yes;
	});
	return Math.min(...parts);
}

/** Each item's probability of passing, by the item's id, from the checks' answers, which are by `<item>/<question>`. */
export function verdictsFrom(
	definition: JudgeDefinition,
	checks: Readonly<Record<string, number>>,
): Record<string, number> {
	const items = [...new Set(Object.keys(checks).map((id) => id.slice(0, id.lastIndexOf("/"))))];
	return Object.fromEntries(items.map((item) => [item, combine(definition, item, checks)]));
}

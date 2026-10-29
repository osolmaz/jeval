import { z } from "zod";

/** A reference label: the expected verdict of every item of one case. Other fields are ignored. */
export const labelSchema = z.object({
	id: z.string(),
	items: z.array(z.object({ id: z.string(), pass: z.boolean() })),
});
export type Label = z.infer<typeof labelSchema>;

/**
 * A judge's verdicts on one case, as its outcome in the case's result gives them: each item's probability of passing,
 * by the item's id; null when the case got no verdicts.
 */
export interface Verdicts {
	readonly verdicts: Readonly<Record<string, number>> | null;
}

export interface Metrics {
	readonly n: number;
	readonly accuracy: number;
	readonly balancedAccuracy: number;
	readonly kappa: number | null;
	readonly judgePass: number;
	readonly labelPass: number;
	readonly falsePasses: number;
	readonly falseFails: number;
}

export interface Report {
	readonly answers: number;
	readonly validAnswers: number;
	readonly invalid: readonly string[];
	readonly items: number;
	/** Items right over all scheduled items, with every item of an invalid answer counted as wrong. */
	readonly itemAgreementOverScheduled: number;
	readonly itemMetrics: Metrics | null;
	readonly answerMetrics: Metrics | null;
	readonly byCategory: Readonly<Record<string, number>>;
}

type Pair = readonly [judge: boolean, label: boolean];

const passes = (probability: number | undefined): boolean => probability !== undefined && probability >= 0.5;

export function metrics(pairs: readonly Pair[]): Metrics | null {
	const n = pairs.length;
	if (n === 0) return null;
	const count = (judge: boolean, label: boolean) => pairs.filter(([j, l]) => j === judge && l === label).length;
	const [tp, fp, fn, tn] = [count(true, true), count(true, false), count(false, true), count(false, false)];
	const accuracy = (tp + tn) / n;
	const expected = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n);
	const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
	const specificity = tn + fp === 0 ? 0 : tn / (tn + fp);
	return {
		n,
		accuracy,
		balancedAccuracy: (recall + specificity) / 2,
		kappa: expected === 1 ? null : (accuracy - expected) / (1 - expected),
		judgePass: (tp + fp) / n,
		labelPass: (tp + fn) / n,
		falsePasses: fp,
		falseFails: fn,
	};
}

function tally(tallies: Map<string, { right: number; all: number }>, category: string, right: boolean): void {
	const current = tallies.get(category) ?? { right: 0, all: 0 };
	tallies.set(category, { right: current.right + (right ? 1 : 0), all: current.all + 1 });
}

function categoryAccuracy(
	labels: readonly Label[],
	verdicts: ReadonlyMap<string, Verdicts>,
	categories: ReadonlyMap<string, string>,
): Record<string, number> {
	const tallies = new Map<string, { right: number; all: number }>();
	for (const label of labels) {
		const given = verdicts.get(label.id)?.verdicts ?? null;
		if (given === null) continue;
		for (const item of label.items) {
			tally(tallies, categories.get(`${label.id}/${item.id}`) ?? "unknown", passes(given[item.id]) === item.pass);
		}
	}
	return Object.fromEntries([...tallies].map(([category, { right, all }]) => [category, right / all]));
}

/**
 * Scores verdicts against reference labels. `categories` maps `case/item` to the item's category. A case without
 * verdicts stays in the scheduled denominator.
 */
export function score(
	labels: readonly Label[],
	verdicts: ReadonlyMap<string, Verdicts>,
	categories: ReadonlyMap<string, string> = new Map(),
): Report {
	const valid = labels.filter((label) => (verdicts.get(label.id)?.verdicts ?? null) !== null);
	const pairs = (label: Label): Pair[] => {
		const given = verdicts.get(label.id)?.verdicts ?? {};
		return label.items.map((item) => [passes(given[item.id]), item.pass] as const);
	};
	const itemPairs = valid.flatMap(pairs);
	const items = labels.reduce((sum, label) => sum + label.items.length, 0);
	return {
		answers: labels.length,
		validAnswers: valid.length,
		invalid: labels.filter((label) => !valid.includes(label)).map((label) => label.id),
		items,
		itemAgreementOverScheduled:
			items === 0 ? 0 : itemPairs.filter(([judge, label]) => judge === label).length / items,
		itemMetrics: metrics(itemPairs),
		answerMetrics: metrics(
			valid.map(
				(label) => [pairs(label).every(([judge]) => judge), label.items.every((item) => item.pass)] as const,
			),
		),
		byCategory: categoryAccuracy(labels, verdicts, categories),
	};
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function formatReport(report: Report): string {
	const item = report.itemMetrics;
	const answer = report.answerMetrics;
	const lines = [
		`Answers: ${String(report.validAnswers)} valid of ${String(report.answers)}; items: ${String(report.items)}`,
		`Items right over all scheduled items: ${percent(report.itemAgreementOverScheduled)}`,
	];
	if (item !== null) {
		lines.push(
			`Item accuracy ${percent(item.accuracy)}, kappa ${item.kappa === null ? "n/a" : item.kappa.toFixed(2)}, judge pass ${percent(item.judgePass)}, label pass ${percent(item.labelPass)}`,
			`False passes ${String(item.falsePasses)}, false fails ${String(item.falseFails)}`,
		);
	}
	if (answer !== null) lines.push(`Whole answers right: ${percent(answer.accuracy)}`);
	const categories = Object.entries(report.byCategory).map(([category, value]) => `${category} ${percent(value)}`);
	if (categories.length > 0) lines.push(`By category: ${categories.join(", ")}`);
	if (report.invalid.length > 0) lines.push(`Invalid: ${report.invalid.join(", ")}`);
	return lines.join("\n");
}

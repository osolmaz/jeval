import { describe, expect, it } from "vitest";
import type { Answer } from "../../src/core/index.ts";
import { formatReport, metrics, score, type Verdicts } from "../../src/eval/score.ts";

const yes: Answer = { kind: "bool", probability: 0.9 };

describe("metrics", () => {
	it("counts accuracy, kappa, pass rates and the two kinds of error", () => {
		const result = metrics([
			[true, true],
			[true, false],
			[false, true],
			[false, false],
			[true, true],
		]);
		expect(result).toMatchObject({
			n: 5,
			accuracy: 0.6,
			judgePass: 0.6,
			labelPass: 0.6,
			falsePasses: 1,
			falseFails: 1,
		});
		expect(result?.kappa).toBeCloseTo(1 / 6);
		expect(result?.balancedAccuracy).toBeCloseTo(7 / 12);
	});

	it("has no metrics without pairs, and no kappa when chance agreement is certain", () => {
		expect(metrics([])).toBeNull();
		expect(metrics([[true, true]])).toMatchObject({ kappa: null, balancedAccuracy: 0.5 });
		expect(metrics([[false, false]])).toMatchObject({ balancedAccuracy: 0.5 });
	});
});

describe("score", () => {
	const labels = [
		{
			id: "c1",
			items: [
				{ id: "S-1", pass: true },
				{ id: "F-1", pass: false },
			],
		},
		{ id: "c2", items: [{ id: "S-1", pass: true }] },
		{ id: "c3", items: [{ id: "S-1", pass: false }] },
	];
	const verdicts = new Map<string, Verdicts>([
		["c1", { answers: { "S-1": yes, "F-1": yes } }],
		["c2", { answers: { "S-1": yes } }],
		["c3", { answers: null }],
	]);

	it("keeps invalid answers in the scheduled denominator and splits accuracy by category", () => {
		const report = score(
			labels,
			verdicts,
			new Map([
				["c1/F-1", "form"],
				["c1/S-1", "substance"],
				["c2/S-1", "substance"],
			]),
		);
		expect(report).toMatchObject({
			answers: 3,
			validAnswers: 2,
			invalid: ["c3"],
			items: 4,
			itemAgreementOverScheduled: 0.5,
		});
		expect(report.itemMetrics).toMatchObject({ n: 3, falsePasses: 1 });
		expect(report.answerMetrics).toMatchObject({ n: 2, accuracy: 0.5 });
		expect(report.byCategory).toEqual({ substance: 1, form: 0 });
	});

	it("treats a missing or non-yes-or-no answer as a fail, and names unknown categories", () => {
		const odd = new Map<string, Verdicts>([
			["c1", { answers: { "S-1": { kind: "score", score: 1, confidence: 1 } } }],
		]);
		const report = score([labels[0] ?? { id: "", items: [] }], odd);
		expect(report.itemMetrics).toMatchObject({ falseFails: 1, falsePasses: 0 });
		expect(report.byCategory).toEqual({ unknown: 0.5 });
		expect(score([], new Map()).itemAgreementOverScheduled).toBe(0);
	});

	it("prints a short report", () => {
		const text = formatReport(score(labels, verdicts, new Map([["c1/S-1", "substance"]])));
		expect(text).toContain("Answers: 2 valid of 3; items: 4");
		expect(text).toContain("Items right over all scheduled items: 50.0%");
		expect(text).toContain("False passes 1, false fails 0");
		expect(text).toContain("Whole answers right: 50.0%");
		expect(text).toContain("By category: substance 100.0%, unknown 50.0%");
		expect(text).toContain("Invalid: c3");
		expect(formatReport(score([{ id: "x", items: [] }], new Map()))).toBe(
			"Answers: 0 valid of 1; items: 0\nItems right over all scheduled items: 0.0%\nInvalid: x",
		);
		expect(formatReport(score([{ id: "c2", items: [{ id: "S-1", pass: true }] }], verdicts))).toContain("kappa n/a");
	});
});

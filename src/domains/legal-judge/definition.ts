import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { BoolQuestion } from "../../core/index.ts";
import type { Item } from "./case.ts";

/** One question asked about every rubric item. `{item}` in its instructions becomes the item's label and text. */
const questionSchema = z
	.object({
		/** The question's id; the item's question is `<item id>/<id>`. */
		id: z.string().regex(/^[a-z][a-z0-9-]*$/),
		/** Whether a yes counts for the item passing or against it. */
		counts: z.enum(["for", "against"]),
		instructions: z.string().includes("{item}"),
		yes: z.string().min(1),
		no: z.string().min(1),
	})
	.strict();

/**
 * A legal judge, complete: the texts the model reads, the questions it answers about each rubric item, and the limits of
 * evidence gathering. Every text the model reads comes from here or from the case.
 */
export const judgeSchema = z
	.object({
		name: z.string().min(1),
		domain: z.literal("legal-judge"),
		limits: z
			.object({
				steps: z.number().int().positive(),
				options: z.number().int().positive(),
				windowShare: z.number().positive().max(1),
			})
			.strict(),
		texts: z
			.object({
				/** The whole process, in the state of every request. */
				process: z.string().min(1),
				/** The gathering stage, in the state of every choice and, followed by `choose`, as the choice's question. */
				gather: z.string().min(1),
				choose: z.string().min(1),
				/** The option that ends gathering. */
				stop: z.string().min(1),
				/** The checking stage, in the state of every check. */
				check: z.string().min(1),
				/** How to apply the rubric, in the state of every check. */
				rules: z.string().min(1),
			})
			.strict(),
		questions: z
			.array(questionSchema)
			.min(1)
			.refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length, {
				message: "question ids must differ",
			}),
	})
	.strict();
export type JudgeDefinition = z.infer<typeof judgeSchema>;

/** A judge definition with the hash that names it: the SHA-256 of its parsed form, so formatting does not count. */
export interface Judge {
	readonly definition: JudgeDefinition;
	readonly hash: string;
}

export function judgeOf(value: unknown): Judge {
	const definition = judgeSchema.parse(value);
	return { definition, hash: createHash("sha256").update(JSON.stringify(definition)).digest("hex") };
}

export async function loadJudge(path: string): Promise<Judge> {
	return judgeOf(JSON.parse(await readFile(path, "utf8")));
}

/** The judge file in this repository, used when a command names none. */
export const DEFAULT_JUDGE = new URL("../../../judges/legal-judge.json", import.meta.url).pathname;

export const itemLabel = (item: Item): string =>
	`Rubric item ${item.id}${item.category === null ? "" : ` (${item.category})`}:\n${item.text}`;

/** The judge's questions about one item. */
export function itemQuestions(definition: JudgeDefinition, item: Item): BoolQuestion[] {
	return definition.questions.map((question) => ({
		kind: "bool",
		id: `${item.id}/${question.id}`,
		instructions: question.instructions.replace("{item}", itemLabel(item)),
		yes: question.yes,
		no: question.no,
	}));
}

/** The verdict on an item, which the judge gives from its questions; this question itself is never asked. */
export const itemVerdict = (item: Item): BoolQuestion => ({
	kind: "bool",
	id: item.id,
	instructions: itemLabel(item),
	yes: "The item passes.",
	no: "The item fails.",
});

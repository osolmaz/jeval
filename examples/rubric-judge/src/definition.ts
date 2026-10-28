import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type BoolQuestion, hashOf } from "@osolmaz/switch";
import { z } from "zod";
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
 * A rubric judge: the texts that tell the model what the task is and how to judge it, the questions it answers about each
 * rubric item, and the limits of evidence gathering. The texts of the steps, such as each choice's text, come from the
 * code, with the domain's version.
 */
export const judgeSchema = z
	.object({
		name: z.string().min(1),
		domain: z.literal("rubric-judge"),
		limits: z
			.object({
				steps: z.number().int().positive(),
				/** Stop and at least one more choice. */
				choices: z.number().int().min(2),
				windowShare: z.number().positive().max(1),
			})
			.strict(),
		texts: z
			.object({
				/** The whole process, in what the model reads in every request. */
				process: z.string().min(1),
				/** The gathering stage, in what the model reads for every pick and, followed by `choose`, in the pick's instructions. */
				gather: z.string().min(1),
				choose: z.string().min(1),
				/** The text of the stop choice, which ends gathering. */
				stop: z.string().min(1),
				/** The checking stage, in what the model reads for every check. */
				check: z.string().min(1),
				/** How to apply the rubric, in what the model reads for every check. */
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
	return { definition, hash: hashOf(definition) };
}

export async function loadJudge(path: string): Promise<Judge> {
	return judgeOf(JSON.parse(await readFile(path, "utf8")));
}

/** The judge file in this example, used when a command names none. */
export const DEFAULT_JUDGE = fileURLToPath(new URL("../judges/general.json", import.meta.url));

export const itemLabel = (item: Item): string =>
	`Rubric item ${item.id}${item.category === null ? "" : ` (${item.category})`}:\n${item.text}`;

/** The judge's questions about one item, by id: `<item id>/<question id>`. */
export function itemQuestions(definition: JudgeDefinition, item: Item): [string, BoolQuestion][] {
	return definition.questions.map((question) => [
		`${item.id}/${question.id}`,
		{
			type: "bool",
			instructions: question.instructions.replace("{item}", itemLabel(item)),
			criteria: { true: question.yes, false: question.no },
		},
	]);
}

/** The verdict on an item, which the judge gives from its questions; this question itself is never asked. */
export const itemVerdict = (item: Item): BoolQuestion => ({
	type: "bool",
	instructions: itemLabel(item),
	criteria: { true: "The item passes.", false: "The item fails." },
});

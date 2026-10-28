import { z } from "zod";

/** One readable part of a file: a PDF page, a group of paragraphs, a sheet's rows, an email. */
export const unitSchema = z.object({ label: z.string(), text: z.string() });

/** An image of a file or of one of its pages, stored next to the case. */
export const renderSchema = z.object({ label: z.string(), path: z.string(), mimeType: z.string() });

export const fileFormats = ["text", "pdf", "docx", "sheet", "email", "slides", "image", "other"] as const;

export const fileSchema = z.object({
	id: z.string(),
	path: z.string(),
	role: z.enum(["answer", "document"]),
	format: z.enum(fileFormats),
	units: z.array(unitSchema),
	words: z.number().int().nonnegative(),
	renders: z.array(renderSchema),
	/** Tracked changes, comments and directly formatted text of a Word file. */
	formatting: z.string().nullable(),
	/** The number of tracked changes and comments in a Word file. */
	marks: z.number().int().nonnegative(),
	/** Why the file could not be read, when it could not. */
	error: z.string().nullable(),
});

export const itemSchema = z.object({ id: z.string(), category: z.string().nullable(), text: z.string() });

/** A rubric-judge case: one answer to one task, with the task's request, rubric and documents. */
export const caseSchema = z.object({
	schema: z.literal(1),
	id: z.string(),
	request: z.string(),
	items: z.array(itemSchema).min(1),
	files: z.array(fileSchema),
});

export type Unit = z.infer<typeof unitSchema>;
export type Render = z.infer<typeof renderSchema>;
export type FileFormat = (typeof fileFormats)[number];
export type CaseFile = z.infer<typeof fileSchema>;
export type Item = z.infer<typeof itemSchema>;
export type JudgeCase = z.infer<typeof caseSchema>;

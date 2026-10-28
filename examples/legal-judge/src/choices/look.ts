import { choiceType, type TypedChoice } from "@osolmaz/switch";
import type { CaseFile, LegalCase, Render } from "../case.ts";
import { found, imagesSeen, type LegalState, SIZES, withEvidence } from "../state.ts";

interface Picture {
	readonly file: CaseFile;
	readonly render: Render;
	readonly index: number;
}

const lookText = ({ file, render }: Picture): string =>
	file.format === "image"
		? `Look at ${file.path}`
		: `Look at ${file.path} ${render.label} (the page has no text layer)`;

/** The key of the look at one image of a file, by the image's place among the file's images. */
export const lookKey = (file: CaseFile, index: number): string => `${file.id}:${String(index)}`;

/** The evidence of a look at an image: its label as text, and the image, which the view loads from the case folder. */
export function lookedAt(file: CaseFile, render: Render, index: number): LegalState["evidence"][number] {
	const label = file.format === "image" ? file.path : `${file.path} ${render.label}`;
	return { key: `look:${lookKey(file, index)}`, source: label, text: `[image: ${label}]`, image: render };
}

/** Look at an image file, or at a page image of a PDF page that has no text layer, until the run saw enough images. */
export const look = (legalCase: LegalCase) =>
	choiceType<LegalState, Picture>({
		type: "look",
		choices: (state) =>
			imagesSeen(state) >= SIZES.images
				? []
				: legalCase.files.flatMap((file) =>
						file.renders.flatMap((render, index): TypedChoice<Picture>[] =>
							found(state, `look:${lookKey(file, index)}`)
								? []
								: [
										{
											key: lookKey(file, index),
											text: lookText({ file, render, index }),
											arg: { file, render, index },
										},
									],
						),
					),
		transition: (state, { file, render, index }) => withEvidence(state, lookedAt(file, render, index)),
	});

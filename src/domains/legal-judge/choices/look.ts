import { choiceKind, type TypedChoice } from "../../../core/index.ts";
import type { CaseFile, Render } from "../case.ts";
import { imagesSeen, LIMITS, type World } from "../world.ts";

interface Picture {
	readonly file: CaseFile;
	readonly render: Render;
}

const lookText = ({ file, render }: Picture): string =>
	file.kind === "image" ? `Look at ${file.path}` : `Look at ${file.path} ${render.label} (the page has no text layer)`;

/** Look at an image file, or at a page image of a PDF page that has no text layer. */
export const look = choiceKind<World, Picture>({
	name: "look",
	when: (_, history) => imagesSeen(history) < LIMITS.images,
	menu: (world) =>
		world.case.files.flatMap((file) =>
			file.renders.map((render, index): TypedChoice<Picture> => ({
				key: `${file.id}:${String(index)}`,
				text: lookText({ file, render }),
				arg: { file, render },
			})),
		),
	async run(world, { file, render }) {
		const image = await world.image(render);
		const label = file.kind === "image" ? file.path : `${file.path} ${render.label}`;
		return { source: label, text: `[image: ${label}]`, images: [image] };
	},
});

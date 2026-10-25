import { action, type Option } from "../../../core/index.ts";
import type { CaseFile, Render } from "../case.ts";
import { imagesSeen, LIMITS, type Workspace } from "../workspace.ts";

interface Picture {
	readonly file: CaseFile;
	readonly render: Render;
}

const lookText = ({ file, render }: Picture): string =>
	file.kind === "image" ? `Look at ${file.path}` : `Look at ${file.path} ${render.label} (the page has no text layer)`;

/** Look at an image file, or at a page image of a PDF page that has no text layer. */
export const look = action<Workspace, Picture>({
	name: "look",
	when: (state) => imagesSeen(state.log) < LIMITS.images,
	options: (state) =>
		state.workspace.case.files.flatMap((file) =>
			file.renders.map((render, index): Option<Picture> => ({
				key: `${file.id}:${String(index)}`,
				text: lookText({ file, render }),
				arg: { file, render },
			})),
		),
	async observe(workspace, { file, render }) {
		const image = await workspace.image(render);
		const label = file.kind === "image" ? file.path : `${file.path} ${render.label}`;
		return { source: label, text: `[image: ${label}]`, images: [image] };
	},
});

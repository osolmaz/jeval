import type { Step } from "../../core/index.ts";
import type { CaseFile } from "./case.ts";
import { LIMITS, partKey, partSource, partText, unreadParts, type World } from "./world.ts";

function readAnswerFile(file: CaseFile, room: number): { steps: Step[]; tokens: number } {
	const steps: Step[] = [];
	let tokens = 0;
	for (const part of unreadParts(file, new Set())) {
		if (tokens + part.tokens > room) break;
		steps.push({
			kind: "read",
			key: `read:${partKey(part)}`,
			observation: { source: partSource(part), text: partText(part) },
		});
		tokens += part.tokens;
	}
	return { steps, tokens };
}

async function lookAtAnswerImages(world: World, file: CaseFile, room: number): Promise<Step[]> {
	const steps: Step[] = [];
	for (const [index, render] of file.renders.slice(0, room).entries()) {
		const image = await world.image(render);
		const observation = { source: file.path, text: `[image: ${file.path}]`, images: [image] };
		steps.push({ kind: "look", key: `look:${file.id}:${String(index)}`, observation });
	}
	return steps;
}

function unreadable(file: CaseFile): Step {
	return {
		kind: "start",
		key: `unreadable:${file.id}`,
		observation: { source: file.path, text: `[the file could not be read: ${file.error ?? "unknown error"}]` },
	};
}

function formatting(file: CaseFile): Step {
	return {
		kind: "changes",
		key: `changes:${file.id}`,
		observation: { source: `${file.path}: formatting`, text: file.formatting ?? "" },
	};
}

/** The answer's files, read before the first choice: its text up to a budget, its images and its Word formatting. */
export async function openAnswer(world: World): Promise<Step[]> {
	const steps: Step[] = [];
	let room = LIMITS.answerTokens;
	for (const file of world.case.files.filter((candidate) => candidate.role === "answer")) {
		if (file.error !== null) {
			steps.push(unreadable(file));
		} else if (file.kind === "image") {
			const images = steps.filter((step) => step.observation.images !== undefined).length;
			steps.push(...(await lookAtAnswerImages(world, file, LIMITS.images - images)));
		} else {
			const opened = readAnswerFile(file, room);
			steps.push(...opened.steps);
			room -= opened.tokens;
			if (file.formatting !== null) steps.push(formatting(file));
		}
	}
	return steps;
}

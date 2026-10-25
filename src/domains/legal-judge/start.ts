import type { Entry } from "../../core/index.ts";
import type { CaseFile } from "./case.ts";
import { LIMITS, partKey, partSource, partText, unreadParts, type Workspace } from "./workspace.ts";

function readAnswerFile(file: CaseFile, room: number): { entries: Entry[]; tokens: number } {
	const entries: Entry[] = [];
	let tokens = 0;
	for (const part of unreadParts(file, new Set())) {
		if (tokens + part.tokens > room) break;
		entries.push({
			action: "read",
			key: `read:${partKey(part)}`,
			observation: { source: partSource(part), text: partText(part) },
		});
		tokens += part.tokens;
	}
	return { entries, tokens };
}

async function lookAtAnswerImages(workspace: Workspace, file: CaseFile, room: number): Promise<Entry[]> {
	const entries: Entry[] = [];
	for (const [index, render] of file.renders.slice(0, room).entries()) {
		const image = await workspace.image(render);
		const observation = { source: file.path, text: `[image: ${file.path}]`, images: [image] };
		entries.push({ action: "look", key: `look:${file.id}:${String(index)}`, observation });
	}
	return entries;
}

function unreadable(file: CaseFile): Entry {
	return {
		action: "start",
		key: `unreadable:${file.id}`,
		observation: { source: file.path, text: `[the file could not be read: ${file.error ?? "unknown error"}]` },
	};
}

function formatting(file: CaseFile): Entry {
	return {
		action: "changes",
		key: `changes:${file.id}`,
		observation: { source: `${file.path}: formatting`, text: file.formatting ?? "" },
	};
}

/** The answer's files, read before the first choice: its text up to a budget, its images and its Word formatting. */
export async function openAnswer(workspace: Workspace): Promise<Entry[]> {
	const entries: Entry[] = [];
	let room = LIMITS.answerTokens;
	for (const file of workspace.case.files.filter((candidate) => candidate.role === "answer")) {
		if (file.error !== null) {
			entries.push(unreadable(file));
		} else if (file.kind === "image") {
			const images = entries.filter((entry) => entry.observation.images !== undefined).length;
			entries.push(...(await lookAtAnswerImages(workspace, file, LIMITS.images - images)));
		} else {
			const opened = readAnswerFile(file, room);
			entries.push(...opened.entries);
			room -= opened.tokens;
			if (file.formatting !== null) entries.push(formatting(file));
		}
	}
	return entries;
}

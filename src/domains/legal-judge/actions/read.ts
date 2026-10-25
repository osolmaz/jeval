import { action, type Option } from "../../../core/index.ts";
import type { CaseFile } from "../case.ts";
import {
	evidenceTokens,
	LIMITS,
	type Part,
	partKey,
	partSource,
	partText,
	partWords,
	readable,
	readParts,
	unreadParts,
	type Workspace,
} from "../workspace.ts";

const describe = (file: CaseFile): string =>
	`${file.path} (${file.kind}${file.units.length > 1 ? `, ${String(file.units.length)} parts` : ""}, ~${String(file.words)} words)`;

function fileOptions(file: CaseFile, read: ReadonlySet<number>, room: number): Option<Part>[] {
	const parts = unreadParts(file, read).filter((part) => part.tokens <= room);
	const [first] = parts;
	if (
		first !== undefined &&
		read.size === 0 &&
		parts.length === 1 &&
		first.from === 0 &&
		first.to === file.units.length - 1
	) {
		return [{ key: partKey(first), text: `Read all of ${describe(file)}`, arg: first }];
	}
	return parts.slice(0, LIMITS.partOptions).map((part, index) => ({
		key: partKey(part),
		text: `Read ${partSource(part)} (${String(partWords(part))} words)`,
		arg: part,
		priority: index === 0 ? 0 : 2,
	}));
}

/** Read a whole file when it is small, otherwise one run of its parts. */
export const read = action<Workspace, Part>({
	name: "read",
	options(state) {
		const room = LIMITS.evidenceTokens - evidenceTokens(state.log);
		const done = readParts(state.log);
		return state.workspace.case.files
			.filter(readable)
			.flatMap((file) => fileOptions(file, done.get(file.id) ?? new Set(), room));
	},
	observe: (_, part) => ({ source: partSource(part), text: partText(part) }),
});

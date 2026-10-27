import { choiceKind, type TypedChoice } from "@osolmaz/switch";
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
	type World,
} from "../world.ts";

const describe = (file: CaseFile): string =>
	`${file.path} (${file.kind}${file.units.length > 1 ? `, ${String(file.units.length)} parts` : ""}, ~${String(file.words)} words)`;

function fileChoices(file: CaseFile, read: ReadonlySet<number>, room: number): TypedChoice<Part>[] {
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
	return parts.slice(0, LIMITS.partChoices).map((part, index) => ({
		key: partKey(part),
		text: `Read ${partSource(part)} (${String(partWords(part))} words)`,
		arg: part,
		priority: index === 0 ? 0 : 2,
	}));
}

/** Read a whole file when it is small, otherwise one run of its parts. */
export const read = choiceKind<World, Part>({
	name: "read",
	menu(world, history) {
		const room = LIMITS.evidenceTokens - evidenceTokens(history);
		const done = readParts(history);
		return world.case.files
			.filter(readable)
			.flatMap((file) => fileChoices(file, done.get(file.id) ?? new Set(), room));
	},
	run: (_, part) => ({ source: partSource(part), text: partText(part) }),
});

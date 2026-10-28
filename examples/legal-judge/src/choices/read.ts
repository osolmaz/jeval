import { choiceType, type TypedChoice } from "@osolmaz/switch";
import type { CaseFile, LegalCase } from "../case.ts";
import {
	evidenceTokens,
	SIZES,
	type LegalState,
	type Part,
	partKey,
	partSource,
	partText,
	partWords,
	readable,
	readParts,
	unreadParts,
	withEvidence,
} from "../state.ts";

const describe = (file: CaseFile): string =>
	`${file.path} (${file.format}${file.units.length > 1 ? `, ${String(file.units.length)} parts` : ""}, ~${String(file.words)} words)`;

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
	return parts.slice(0, SIZES.partChoices).map((part, index) => ({
		key: partKey(part),
		text: `Read ${partSource(part)} (${String(partWords(part))} words)`,
		arg: part,
		priority: index === 0 ? 0 : 2,
	}));
}

/** Read a whole file when it is small, otherwise one run of its parts that the evidence does not hold yet. */
export const read = (legalCase: LegalCase) =>
	choiceType<LegalState, Part>({
		type: "read",
		choices(state) {
			const room = SIZES.evidenceTokens - evidenceTokens(state);
			const done = readParts(state);
			return legalCase.files
				.filter(readable)
				.flatMap((file) => fileChoices(file, done.get(file.id) ?? new Set(), room));
		},
		transition: (state, part) =>
			withEvidence(state, { key: `read:${partKey(part)}`, source: partSource(part), text: partText(part) }),
	});

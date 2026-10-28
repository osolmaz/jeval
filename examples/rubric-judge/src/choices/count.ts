import { choiceType, typedKey } from "@osolmaz/switch";
import type { CaseFile, JudgeCase } from "../case.ts";
import { found, type JudgeState, TYPES, withEvidence } from "../state.ts";

/** The key of the one count within its type. */
const WORDS = "words";
const LENGTH = /\bwords?\b|word count|length|\bpages?\b|sentences?|concise/i;
const HEADING = /^(#{1,6}\s+.+|\*\*[^*]{2,80}\*\*\s*$|P\d+ \[Heading[^\]]*\]: .+)$/;

const wordsIn = (line: string): number => line.split(/\s+/).filter(Boolean).length;

/** A file's words in total and under each heading. */
export function countWords(file: CaseFile): string {
	const lines = file.units.flatMap((unit) => unit.text.split("\n"));
	const out = [`${file.path}: ${String(file.words)} words in total.`];
	let heading = "(before the first heading)";
	let words = 0;
	const flush = () => {
		if (words > 0) out.push(`  ${heading}: ${String(words)} words`);
	};
	for (const line of lines) {
		if (HEADING.test(line)) {
			flush();
			heading = line.replace(/^#+\s*|\*\*/g, "").slice(0, 80);
			words = 0;
		} else {
			words += wordsIn(line);
		}
	}
	flush();
	return out.join("\n");
}

/** Count the answer's words once, offered when a rubric item is about length. */
export const count = (judgeCase: JudgeCase) =>
	choiceType<JudgeState, null>({
		type: TYPES.count,
		choices: (state) =>
			judgeCase.items.some((item) => LENGTH.test(item.text)) && !found(state, typedKey(TYPES.count, WORDS))
				? [{ key: WORDS, text: "Count the words of the answer, in total and for each section", arg: null }]
				: [],
		transition: (state, _arg, key) =>
			withEvidence(state, {
				key,
				source: "word counts of the answer",
				text: judgeCase.files
					.filter((file) => file.role === "answer" && file.format !== "image")
					.map(countWords)
					.join("\n"),
			}),
	});

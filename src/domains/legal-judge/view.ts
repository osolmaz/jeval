import type { Json, JsonObject, State, View } from "../../core/index.ts";
import type { CaseFile } from "./case.ts";
import type { JudgeDefinition } from "./definition.ts";
import { LIMITS, readParts, type Workspace } from "./workspace.ts";

const size = (value: Json): number => Math.ceil(JSON.stringify(value).length / LIMITS.charsPerToken);

function readStatus(file: CaseFile, read: ReadonlySet<number> | undefined): string {
	if (read === undefined || read.size === 0) return "no";
	return read.size >= file.units.length ? "all" : `${String(read.size)} of ${String(file.units.length)} parts`;
}

function chooseState(state: State<Workspace>, texts: JudgeDefinition["texts"]): JsonObject {
	const legalCase = state.workspace.case;
	const read = readParts(state.log);
	return {
		process: texts.process,
		stage: texts.gather,
		request: legalCase.request,
		rubric: legalCase.items.map((item) => ({ id: item.id, criterion: item.text })),
		files: legalCase.files.map((file) => ({
			path: file.path,
			role: file.role,
			kind: file.kind,
			words: file.words,
			read: readStatus(file, read.get(file.id)),
		})),
		steps_taken: state.log.map((entry) => entry.observation.source),
	};
}

interface Evidence {
	readonly source: string;
	readonly text: string;
}

/** Cuts the longest evidence first until the evidence fits `room` tokens, and says what it cut. */
export function fitEvidence(evidence: readonly Evidence[], room: number): { evidence: Evidence[]; omitted: string[] } {
	const over = size(evidence.map(({ source, text }) => ({ source, text }))) - room;
	if (over <= 0) return { evidence: [...evidence], omitted: [] };
	let excess = over * LIMITS.charsPerToken;
	const cuts = new Map<number, number>();
	const longest = evidence
		.map((entry, index) => ({ index, length: entry.text.length }))
		.sort((a, b) => b.length - a.length);
	for (const { index, length } of longest) {
		if (excess <= 0) break;
		const cut = Math.min(length, excess + 80);
		cuts.set(index, cut);
		excess -= cut;
	}
	const omitted: string[] = [];
	const fitted = evidence.map((entry, index) => {
		const cut = cuts.get(index);
		if (cut === undefined) return entry;
		omitted.push(`${String(cut)} characters of ${entry.source}`);
		const kept = entry.text.slice(0, Math.max(0, entry.text.length - cut));
		return { source: entry.source, text: `${kept}\n[cut: ${String(cut)} characters left out to fit the window]` };
	});
	return { evidence: fitted, omitted };
}

/** The state the model sees: for a choice, the rubric and the files as well; for the answers, the evidence. */
export function view(
	texts: JudgeDefinition["texts"],
	state: State<Workspace>,
	purpose: "choose" | "answer",
	tokens: number,
): View {
	const base = purpose === "choose" ? chooseState(state, texts) : { request: state.workspace.case.request };
	const evidence = state.log.map(({ observation }) => ({ source: observation.source, text: observation.text }));
	const fitted = fitEvidence(evidence, tokens - size(base));
	return {
		state: { ...base, evidence: fitted.evidence.map(({ source, text }) => ({ source, text })) },
		images: state.log.flatMap(({ observation }) => observation.images ?? []),
		omitted: fitted.omitted,
	};
}

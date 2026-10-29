import {
	type Answers,
	choiceType,
	type DomainShared,
	joinTypes,
	type JsonObject,
	picking,
	type RunResult,
	type StateMachine,
} from "@osolmaz/switch";
import { changes } from "./choices/changes.ts";
import { compare } from "./choices/compare.ts";
import { count } from "./choices/count.ts";
import { look } from "./choices/look.ts";
import { read } from "./choices/read.ts";
import { search } from "./choices/search.ts";
import { itemQuestions, type Judge, type JudgeDefinition } from "./definition.ts";
import { verdictsFrom } from "./judge.ts";
import { openAnswer } from "./start.ts";
import type { CaseFolder, JudgeState } from "./state.ts";
import { searchTerms } from "./terms.ts";
import { view } from "./view.ts";

/** The version of this domain's code. A run records the judge apart, as its definition with its hash. */
export const CODE_VERSION = "0.6.0";

/**
 * What every case shares under a judge: the domain's name and version, and the share of the window that a request may
 * fill. The judge's own limit on gathering steps ends every run, so the run needs no step limit of switch's.
 */
export function rubricJudge({ definition }: Judge): DomainShared {
	return { name: "rubric-judge", version: CODE_VERSION, limits: { windowShare: definition.limits.windowShare } };
}

/** Stop gathering evidence: always among the choices while the model gathers, and never cut. */
const stopGathering = (text: string) =>
	choiceType<JudgeState, null>({
		type: "stop",
		choices: () => [{ key: "stop", text, arg: null, priority: -1 }],
		transition: (state) => ({ ...state, gathered: true }),
	});

/** The probability of yes of each bool answer, by the question's id. */
const yesOf = (answers: Answers): Record<string, number> =>
	Object.fromEntries(
		Object.entries(answers).flatMap(([id, answer]) => (answer.type === "bool" ? [[id, answer.probability]] : [])),
	);

/**
 * The state machine of one case. The model gathers evidence with one pick in each state, until it picks stop, takes as
 * many steps as the judge allows, or has nothing left to gather. Then one step asks the judge's questions about every
 * rubric item, and the run is over: the outcome joins each item's answers into its verdict.
 *
 * The state says when gathering is over, also at the judge's limit, so that a fork of the state before the checks
 * under another judge, with another limit, asks only the checks again.
 */
export function judgeMachine(definition: JudgeDefinition, folder: CaseFolder): StateMachine<JudgeState> {
	const judgeCase = folder.case;
	const { texts, limits } = definition;
	const gathering = joinTypes(
		read(judgeCase),
		look(judgeCase),
		search(judgeCase, searchTerms(judgeCase)),
		count(judgeCase),
		changes(judgeCase),
		compare(judgeCase),
		stopGathering(texts.stop),
	);
	const pick = picking({
		instructions: `${texts.gather} ${texts.choose}`,
		limit: limits.choices,
		choices: gathering.choices,
		transition: async (state, choice) => {
			const next = await gathering.transition(state, choice);
			const steps = state.steps + 1;
			return { ...next, steps, gathered: next.gathered || steps >= limits.steps };
		},
	});
	const checks = Object.fromEntries(judgeCase.items.flatMap((item) => itemQuestions(definition, item)));
	// Stop alone is no pick worth a request: the checks follow at once.
	const onlyStop = (state: JudgeState) => gathering.choices(state).every((choice) => choice.type === "stop");
	const checking = (state: JudgeState) => state.gathered || state.steps >= limits.steps || onlyStop(state);
	return {
		initial: () => Promise.resolve(openAnswer(judgeCase)),
		questions: (state) => {
			if (state.checks !== null) return {};
			return checking(state) ? checks : pick.questions(state);
		},
		transition: (state, answers) =>
			checking(state) ? Promise.resolve({ ...state, checks: yesOf(answers) }) : pick.transition(state, answers),
		view: (state, tokens, charsPerToken) => view(texts, folder, state, checking(state), tokens, charsPerToken),
	};
}

/**
 * How a case ended under `definition`: each rubric item's probability of passing, by the item's id. The verdicts are
 * null when the run ended before the checks, such as when a request failed.
 */
export const judgeOutcome =
	(definition: JudgeDefinition) =>
	({ state }: Pick<RunResult<JudgeState>, "state">): JsonObject => ({
		verdicts: state.checks === null ? null : verdictsFrom(definition, state.checks),
	});

export { type JudgeCase, caseSchema } from "./case.ts";
export { DEFAULT_JUDGE, type Judge, type JudgeDefinition, judgeOf, loadJudge } from "./definition.ts";
export type { CaseFolder, Evidence, JudgeState } from "./state.ts";

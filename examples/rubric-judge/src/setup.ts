import { type Runner, runnerOf } from "@osolmaz/switch";
import type { DomainSetup } from "@osolmaz/switch/cli";
import { DEFAULT_JUDGE, judgeMachine, judgeOutcome, loadJudge, rubricJudge } from "./index.ts";
import { loadCase } from "./load.ts";

/**
 * The rubric-judge domain, set up with the judge in `file`, or with the default judge: a judge file is this domain's
 * definition.
 */
export async function rubricJudgeSetup(file: string | undefined): Promise<Runner> {
	const judge = await loadJudge(file ?? DEFAULT_JUDGE);
	return runnerOf({
		...rubricJudge(judge),
		definition: { name: judge.definition.name, hash: judge.hash, content: judge.definition },
		caseId: async (folder) => (await loadCase(folder)).case.id,
		load: async (folder) => judgeMachine(judge.definition, await loadCase(folder)),
		outcome: judgeOutcome(judge.definition),
	});
}

/** The rubric-judge domain of the harness, with its own flag, `--judge <file>`, for `run` and `replay`. */
export const rubricJudgeDomain: DomainSetup = {
	flags: [{ flag: "--judge <file>", description: "the judge file; the default judge by default" }],
	setup: (flags) => rubricJudgeSetup(flags["judge"]),
};

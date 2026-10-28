import { type Runner, runnerOf } from "@osolmaz/switch";
import { DEFAULT_JUDGE, legalJudge, legalMachine, loadJudge } from "./index.ts";
import { loadCase } from "./load.ts";

/**
 * The legal-judge domain, set up with the judge in `file`, or with the default judge: a judge file is this domain's
 * definition.
 */
export async function legalJudgeSetup(file: string | undefined): Promise<Runner> {
	const judge = await loadJudge(file ?? DEFAULT_JUDGE);
	return runnerOf({
		...legalJudge(judge),
		definition: { name: judge.definition.name, hash: judge.hash, content: judge.definition },
		limits: judge.definition.limits,
		caseId: async (folder) => (await loadCase(folder)).case.id,
		load: async (folder) => legalMachine(judge.definition, await loadCase(folder)),
	});
}

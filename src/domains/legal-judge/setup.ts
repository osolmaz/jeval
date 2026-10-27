import { type Runner, runnerOf } from "../../core/index.ts";
import { DEFAULT_JUDGE, legalJudge, loadJudge } from "./index.ts";
import { loadCase } from "./load.ts";

/**
 * The legal-judge domain, set up with the judge in `file`, or with the default judge: a judge file is this domain's
 * definition. Each rubric item's category goes with the case, for reports.
 */
export async function legalJudgeSetup(file: string | undefined): Promise<Runner> {
	const judge = await loadJudge(file ?? DEFAULT_JUDGE);
	return runnerOf({
		domain: legalJudge(judge),
		definition: { name: judge.definition.name, hash: judge.hash, content: judge.definition },
		limits: judge.definition.limits,
		caseId: async (folder) => (await loadCase(folder)).case.id,
		load: loadCase,
		categories: (workspace) =>
			Object.fromEntries(workspace.case.items.map((item) => [item.id, item.category ?? "unknown"])),
	});
}

import { run, STOP_KEY } from "../../src/core/index.ts";
import { storyOf } from "../../src/view/frames.ts";
import type { Session } from "../../src/view/web/model.ts";
import { answering, factsDomain, fakeDecider } from "./fakes.ts";

/**
 * A case of the test domain, which has no part of the page: the model looks up `steps` facts, then stops, and answers
 * every fact's question. As the viewer receives it.
 */
export async function factsSession(options: { steps?: number; finished?: boolean } = {}): Promise<Session> {
	const { steps = 2, finished = true } = options;
	let calls = 0;
	const decider = fakeDecider(answering(0.7, (labels) => (calls++ < steps ? (labels[0] ?? STOP_KEY) : STOP_KEY)));
	const facts = { facts: { a: "fact a", b: "fact b", c: "fact c" } };
	const result = await run(factsDomain, facts, decider, { case: "f1" });
	return {
		story: storyOf(result.trace.entries),
		outcome: finished ? { result: "answered", reason: "the model stopped", looked: steps } : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

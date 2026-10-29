import { run } from "@osolmaz/switch";
import { storyOf } from "../../src/frames.ts";
import type { Session } from "../../src/web/model.ts";
import { answering, factsMachine, FACTS, fakeDecider } from "./fakes.ts";

/**
 * A case of the test domain, which has no part of the page: the model looks up `steps` facts, then stops looking, and
 * answers every fact's question. As the viewer receives it.
 */
export async function factsSession(options: { steps?: number; finished?: boolean } = {}): Promise<Session> {
	const { steps = 2, finished = true } = options;
	let calls = 0;
	const decider = fakeDecider(
		answering(0.7, (labels) => (calls++ < steps ? (labels[0] ?? "o1") : (labels.at(-1) ?? "o1"))),
	);
	const machine = factsMachine({ facts: { a: "fact a", b: "fact b", c: "fact c" } });
	const result = await run(FACTS, machine, decider);
	return {
		story: storyOf(result.trace.entries, "f1"),
		outcome: finished ? { result: "answered", reason: "the model stopped", looked: steps } : null,
		summary: finished ? "answered · the model stopped" : null,
		finished,
		version: `${String(result.trace.entries.length)}:${String(finished)}`,
	};
}

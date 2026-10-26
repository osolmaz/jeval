<p align="center">
  <img src="assets/cover.svg" alt="Switch: a framework for building decision-model harnesses for any kind of task" width="880">
</p>

# Switch

Switch is a framework for building decision-model harnesses for any kind of task. A decision model is a classifier
that answers typed questions about what it has been shown, such as TypeSafe's Jev. At each step, your program offers
the model a short list of possible next steps and the model picks one. Your program carries out that step and shows
the model what it found, and this repeats until the model can answer the task's questions. The name comes from a
railway switch, where one track splits into a few: your program lays the tracks, and the model sets the switch.

The task itself comes from a domain, which you write in a few small pieces of TypeScript. A domain defines the
workspace of one case and the actions that can be taken in it. It also sets the questions the model answers at the end
and how the state is shown to the model. Switch runs the same loop for every domain and keeps the model's probability
for every option on every menu. It fits the state into the model's window and writes a trace of every step, which can
be replayed or forked. Switch ships one domain, `legal-judge`, which grades answers to legal tasks against a rubric. The
same loop fits any task where a model should look around before it decides, such as routing a support ticket after
reading its logs or deciding whether a report needs a person.

## Install

Switch needs Node.js 22.13 or newer and pnpm. To use it as a library or command in another project, add it pinned to a
commit; installing builds it.

```bash
pnpm add github:osolmaz/switch#<commit>
```

To work on Switch itself, clone it and run `pnpm install`. The `legal-judge` domain also needs Poppler and LibreOffice
to read PDF scans and old Word files, and Netpbm to scale images.

## Write a domain

A domain is a folder in `src/domains/`. Its actions each list the options that make sense in the current state and
say what running one finds. This domain routes a support ticket and lets the model read the ticket's logs first:

```ts
import { action, type Domain } from "../../core/index.ts";

interface Ticket {
  readonly text: string;
  readonly logs: Readonly<Record<string, string>>;
}

const readLog = action<Ticket, string>({
  name: "read-log",
  options: (state) => Object.keys(state.workspace.logs).map((name) => ({ key: name, text: `Read ${name}`, arg: name })),
  observe: (ticket, name) => ({ source: name, text: ticket.logs[name] ?? "" }),
});

export const triage: Domain<Ticket> = {
  name: "triage",
  version: "0.1.0",
  actions: [readLog],
  stop: "Stop reading: the evidence is enough",
  choose: "Which log should be read next to route this ticket?",
  questions: () => [
    {
      kind: "choice",
      id: "team",
      instructions: "Which team should handle the ticket?",
      choices: { billing: "Billing", infra: "Infrastructure", app: "Application" },
    },
  ],
  start: (ticket) =>
    Promise.resolve([{ action: "start", key: "ticket", observation: { source: "ticket", text: ticket.text } }]),
  view: (state) => ({
    state: { evidence: state.log.map(({ observation }) => ({ source: observation.source, text: observation.text })) },
    images: [],
    omitted: [],
  }),
};
```

The model reads the ticket and opens logs one step at a time until it picks stop, then answers the question. Each question has a type, here a `choice`. Every answer comes with the model's probabilities. Any
classifier model that pi-ai lists can decide, with its key from the environment:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { run } from "../../core/index.ts";
import { piAiDecider } from "../../models/pi-ai.ts";

const decider = piAiDecider("typesafe/jev-latest", { registry: builtinModels(), apiKey: process.env.TYPESAFE_API_KEY });
const result = await run(triage, ticket, decider, { case: "ticket-1" });
```

`result.answers` holds the answers. `result.trace` holds every menu the model saw with the probability it gave each
option, and what each step found. A domain that needs more than one round of questions, such as asking about each part
of an item before deciding the item, adds a `judge` function that asks in stages. `src/domains/legal-judge/` is the
complete example, and [docs/2026-10-25-switch-plan.md](docs/2026-10-25-switch-plan.md) explains the design.

## Legal judge

The `legal-judge` domain grades a saved answer to a legal task. The model reads the answer and gathers what it needs from
the task's documents one step at a time. Then it answers two questions per rubric item, whether the answer meets it and
whether it misses or contradicts any requirement. An item passes when both checks
pass. Every text the model reads is in a judge file, `judges/legal-judge.json`, so a variant of the judge is another
file passed with `--judge`.

A case starts as an input folder that holds the request in `request.md` and the rubric in `rubric.json`
(`{"items": [{"id", "category", "text"}]}`), with the task's files under `documents/` and the answer's files under
`answer/`. `ingest` turns it into a case folder, and
`run` grades case folders with a pi-ai classifier model whose key it reads from `PROVIDER_API_KEY`, for example
`TYPESAFE_API_KEY` for `typesafe/jev-latest`:

```bash
node src/cli/main.ts ingest input/case-1 cases/case-1
node src/cli/main.ts run cases/case-1 --out results --model typesafe/jev-latest
```

A run writes one folder. `run.json` records what ran, including the judge's hash and the Switch commit. Each case keeps
its answers and a trace of every step, and `requests.jsonl` keeps every request exactly as the model received it. A
stopped run goes on in the same folder.

To measure a judge, an eval set file names the case folders and the scheduled case ids. It also points to a labels
file in JSON Lines (`{"id", "items": [{"id", "pass"}]}`). `score` checks a run against the set's labels.
`rejudge` asks another judge file or model over the evidence an earlier run gathered, for about a third of the cost
of a new run. `compare` then scores runs side by side on the cases that all of them answered:

```bash
node src/cli/main.ts run --set sets/quick.json --out results
node src/cli/main.ts rejudge --set sets/quick.json --from results --out results-strict --judge judges/strict.json
node src/cli/main.ts compare results results-strict --set sets/quick.json
```

`replay` runs a case again from its trace, and with `--fork <steps>` it repeats that many recorded steps and lets the
model go on from there.

## License

[MIT](LICENSE)

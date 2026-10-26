<p align="center">
  <img src="assets/cover.svg" alt="switch: a framework for building decision-model harnesses for any kind of task" width="880">
</p>

# switch

switch is a framework for building decision-model harnesses for any kind of task.

A decision model reads a state, such as text or a JSON object, and answers typed questions about it. It picks one of a
list of options, rates the state on a scale, or gives the probability that a statement is true, and every answer comes
with the model's probabilities. It writes no text. TypeSafe calls them
[System One models](https://docs.typesafe.ai/concepts/system-one), and its Jev was the first. Open models followed:
llama.cpp [serves decision models](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp) through the same
API as Jev, and the Hugging Face Hub tags thousands of models as
[`decision-model`](https://huggingface.co/models?other=decision-model). The community
[Decision Index](https://huggingface.co/spaces/multimodalart/jev-decision-index) on Hugging Face compares many of
them with Jev on tasks such as tool use, retrieval, reasoning and games.

Decision models are fast and cheap, but they cannot write a tool call, so the usual agent loop does not fit them.
switch gives them a loop that does. At each step, your program offers the model a short list of possible next steps
and the model picks one. Your program carries out that step and shows the model what it found, and this repeats until
the model can answer the task's questions. The name comes from a railway switch, where one track splits into a few:
your program lays the tracks, and the model sets the switch.

The task itself comes from a domain, which you write in a few small pieces of TypeScript. A domain defines the
workspace of one case and the actions that can be taken in it. It also sets the questions the model answers at the end
and how the state is shown to the model. switch runs the same loop for every domain and keeps the model's probability
for every option on every menu. It fits the state into the model's window and writes a trace of every step, which can
be replayed or forked. switch ships two domains: `legal-judge`, which grades answers to legal tasks against a rubric, and `chess`. The
same loop fits any task where a model should look around before it decides, such as routing a support ticket after
reading its logs or deciding whether a report needs a person.

## Install

switch needs Node.js 22.13 or newer and pnpm. To use it as a library or command in another project, add it pinned to a
commit; installing builds it.

```bash
pnpm add github:osolmaz/switch#<commit>
```

To work on switch itself, clone it and run `pnpm install`. A domain that needs other programs lists them in its own
README.

## Domains

Each domain has a README that says what it does, what else it needs installed and how to run it.

- [Legal judge](src/domains/legal-judge/README.md) (`legal-judge`) grades a saved answer to a legal task against the
  task's rubric.
- [Chess](src/domains/chess/README.md) (`chess`) plays a game of chess against an opponent that picks random legal
  moves.

## Watch a run

`view` opens a run in the browser and plays it back step by step: each step's options with the model's probability
for every one, the chosen option and what the step found. A chess game gets a board with moving pieces, arrows for the
model's likeliest moves, the move list and a PGN download. Add `--view` to `run` to watch the cases while they run; each
case's page follows it live:

```bash
node src/cli/main.ts run --domain chess examples/chess/white-seed-1 --out runs/chess --view
```

The run folder keeps everything a later `view runs/chess` needs to play the cases back. A case's page can also be saved
as one HTML file that opens without switch, from the page itself or with `view --html <file>`.

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

## License

[MIT](LICENSE)

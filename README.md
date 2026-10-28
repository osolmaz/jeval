<p align="center">
  <img src="assets/cover.svg" alt="switch: a framework for building decision-model harnesses for any kind of task" width="880">
</p>

# switch

switch is a framework for building decision-model harnesses for any kind of task.

A decision model reads some content, such as text or a JSON object, and answers typed questions about it. It picks one
of the answers that a question allows, rates the content on a scale, or gives the probability that a statement is true,
and every answer comes with the model's probabilities. It writes no text. TypeSafe calls them
[System One models](https://docs.typesafe.ai/concepts/system-one), and its Jev was the first. Open models followed:
llama.cpp [serves decision models](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp) through the same
API as Jev, and the Hugging Face Hub tags thousands of models as
[`decision-model`](https://huggingface.co/models?other=decision-model). The community
[Decision Index](https://huggingface.co/spaces/multimodalart/jev-decision-index) on Hugging Face compares many of
them with Jev on tasks such as tool use, retrieval, reasoning and games.

Decision models are fast and cheap, but they cannot write a tool call, so the usual agent loop does not fit them.
switch gives them a loop that does. At each step, your program offers the model a short list of choices, and the model
picks one. Your program carries out the choice and shows the model where the task is now, and this repeats until the
model can answer the task's questions. The name comes from a railway switch, where one track splits into a few: your
program lays the tracks, and the model sets the switch.

The task itself comes from a domain, which you write in TypeScript. For each case, a domain gives a state machine: an
initial state, a choice function that gives the choices in a state, and a transition function that gives the next
state after the model's pick. These three are the whole interface that a domain must give. Behind them, a domain may
use any library, program or data of its own, such as a chess engine. A domain may also set the questions that the
model answers at the end, and the view function, which turns a state into what the model reads. switch runs the same
loop for every domain and keeps the model's probability for every choice of every step. It gives the view function a
budget that fits the model's window, asks for a smaller view when a request is still too long, and writes a trace of
every state, which can be replayed or forked. What goes to the model and comes back follows the classifier interface of
the [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) library, so any classifier model that pi-ai lists can
decide; [docs/DECISION_MODEL_API.md](docs/DECISION_MODEL_API.md) explains these APIs. Two example harnesses in [`examples/`](examples) use switch
the way another project would: `legal-judge`, which grades answers to legal tasks against a rubric, and `chess`. The
same loop fits any task where a model should look around before it decides, such as routing a support ticket after
reading its logs or deciding whether a report needs a person.

## How it works

Each case is a state machine. A run of one case goes like this:

1. The domain makes the case's **initial state**. A **state** is everything that the domain needs to know about where
   the case is, as JSON, such as the evidence read so far or the moves of a chess game.
2. The **choice function** takes the latest state and gives the **choices** in it. Each choice has a type, such as
   `read` or `move`, a key and a text that the model reads. switch checks the choices, cuts them to its limit and adds
   stop.
3. The **view function** takes the state and gives the **view**: the `decisionState`, a JSON object, and any
   `decisionImages` that the model sees with it. switch adds the pick question, whose answers are the choices, and the
   model **picks** one choice, with a probability for every choice.
4. The **transition function** takes the state and the picked choice, does the work of the choice, and gives the next
   state. One pass of the choices, the pick and the transition is a **step**.
5. The run goes back to the choice function, until the model picks stop, the state has no choices, the step limit is
   reached, or a pick fails. Then the model answers the domain's **questions**, and every **answer** comes with its
   probabilities.

The **trace** of a run keeps every state, the choices of each step with the model's probabilities, each pick, why the
steps ended, and the answers. So a replay reads the states from the trace and runs no transition again.

## Install

switch needs Node.js 22.18 or newer, which runs TypeScript sources without a flag, and pnpm. To use it in another project, add it pinned to a commit; installing
builds it.

```bash
pnpm add github:osolmaz/switch#<commit>
```

The package has these entry points:

| Import                    | What it gives                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `@osolmaz/switch`         | The loop, the types of a domain and its state machine, the choice checks, traces and replay         |
| `@osolmaz/switch/models`  | `piAiDecider`, which asks a classifier model that pi-ai lists                                       |
| `@osolmaz/switch/cli`     | `commandLine`, which gives a harness the `run` and `replay` commands, and the functions behind them |
| `@osolmaz/switch/testing` | A fake decider that answers by a rule, for tests that make no model calls                           |

switch has no user interface. The web viewer that plays runs back in the browser is a package of its own,
[`viewer/`](viewer/README.md), which uses switch as the examples do.

To work on switch itself, clone it and run `pnpm install`.

## Examples

Each example is a package of its own in `examples/`, with a README that says what it does, what else it needs
installed and how to run it. Its program is `src/main.ts`, which runs from the repository root.

- [Legal judge](examples/legal-judge/README.md) (`legal-judge`) grades a saved answer to a legal task against the
  task's rubric.
- [Chess](examples/chess/README.md) (`chess`) plays a game of chess against an opponent that picks random legal
  moves, against Stockfish, or against itself.

## Watch a run

A run folder keeps every case's trace, so another program can show it. The [viewer](viewer/README.md) is one: both
examples add its `view` command, which plays a run back in the browser step by step, and follows each case live while
it runs.

```bash
examples/chess/src/main.ts run examples/chess/cases/white-seed-1 --out runs/chess
examples/chess/src/main.ts view runs/chess
```

## Replay a case

`replay` runs a case again from its trace, under the trace's limits. It takes each recorded pick by its key and each
state from the trace, so no transition runs and no model is asked. It ends as the recorded steps ended, and repeats
the recorded answers, or their failure. A replay thus gives the recorded case, even when a transition would find
something else now, such as the reply of a chess engine. It fails, and the command exits with an error, when the
trace is of another domain or case, or when the domain's code no longer gives the choices that the run saw: a recorded
pick that is not among the choices, no choices where the run had some, or choices where its steps ended. A definition
that changed since is noted in the replay's trace. With `--fork <n>`, `replay` repeats only the first n steps, and the
model that `--model` names picks and answers from there, with the transitions running again. With `--out <folder>`,
it writes the replay as a run folder of one case, which the viewer can show:

```bash
examples/chess/src/main.ts replay examples/chess/cases/white-seed-1 runs/chess/cases/white-seed-1/trace.jsonl --fork 5 --out runs/fork
```

`run --state-from <run>` repeats the steps of each case that it runs from an earlier run in this way, under that run's
limits, and asks the model only the questions again, for example with another definition or model. A case that the
earlier run does not have fails.

A run folder holds `run.json`, with what ran, the limits that the cases ran under, and, at the end, its totals: the
cases, the failed ones, the requests and their summed usage, cost included. Each case has its `result.json` with its
answers, why its steps ended, why its answers failed if they did, and the error that stopped the case if one did; its
`trace.jsonl`; and its `requests.jsonl`, with every decision request and its result. When a stopped run goes on, it
runs again each case that has no result, or whose case was stopped by an error.

## Write a domain

A domain gives each case as a state machine. The state is JSON that the domain designs. The choice function gives the
choices in a state, and the transition function does the work of the picked choice and gives the next state. The
case's own data, which never changes, stays inside the functions. This domain routes a support ticket and lets the
model read the ticket's logs first:

```ts
import type { Choice, DomainShared, JsonObject, StateMachine } from "@osolmaz/switch";

export interface Ticket {
  readonly text: string;
  readonly logs: Readonly<Record<string, string>>;
}

/** Where a ticket is: the logs read so far, with what each one said. */
interface TriageState extends JsonObject {
  readonly read: readonly { readonly log: string; readonly text: string }[];
}

/** A log to read; the transition gets the choice back. */
interface ReadLog extends Choice {
  readonly log: string;
}

export const TRIAGE: DomainShared = {
  name: "triage",
  version: "0.1.0",
  stop: "Stop reading: the evidence is enough",
  instructions: "Which log should be read next to route this ticket?",
  limits: { steps: 8, choices: 20, windowShare: 0.9 },
};

export function triageMachine(ticket: Ticket): StateMachine<TriageState, ReadLog> {
  return {
    initial: () => Promise.resolve({ read: [] }),
    choices: (state) =>
      Object.keys(ticket.logs)
        .filter((log) => !state.read.some((entry) => entry.log === log))
        .map((log) => ({ type: "read-log", key: log, text: `Read ${log}`, log })),
    transition: (state, choice) =>
      Promise.resolve({ read: [...state.read, { log: choice.log, text: ticket.logs[choice.log] ?? "" }] }),
    view: (state) => Promise.resolve({ decisionState: { ticket: ticket.text, read: state.read } }),
    questions: () => ({
      team: {
        type: "choice",
        instructions: "Which team should handle the ticket?",
        criteria: { billing: "Billing", infra: "Infrastructure", app: "Application" },
      },
    }),
  };
}
```

The model reads the ticket and opens logs one step at a time until it picks stop, then answers the question. The
questions are pi-ai's, by id: a `bool`, a `choice` or a `score` question, each with its `criteria`. Every answer comes
with the model's probabilities. Only `initial`, `choices` and `transition` are needed: without a view function, the
model reads the state as it is, and without questions, the run asks nothing. A view function also gets the most tokens
that its view may take, and the decider's characters per token, so that it can measure with `estimateTokens`; when the
model says that a request was still too long, switch asks it for a smaller view. A choice function must leave out what
the state says is done, because switch refuses a choice that the model picked before. The limits are the most steps of
a run, the most choices that the model sees in one step, stop included, which is at least 2, and the share of the
model's window that a request may fill. Any classifier model that pi-ai lists can decide; pi-ai finds its key in the
environment, such as `TYPESAFE_API_KEY`:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { run } from "@osolmaz/switch";
import { piAiDecider } from "@osolmaz/switch/models";

const decider = piAiDecider("typesafe/jev-latest", { registry: builtinModels() });
const result = await run(TRIAGE, triageMachine(ticket), decider);
```

`result.answers` holds the answers, and `result.state` the last state. `result.trace` holds every state, every choice
that the model saw with the probability it gave it, and each pick. `result.ended` tells why the steps ended: the model
picked stop, the state had no choices, the steps ran out, or the pick failed. A domain with several types of choice
can give each type in a file of its own with `choiceType`, and join them with `joinTypes`. A type's transition gets the
picked choice's key, which `typedKey` makes from the type and the key within it, so that the state can record what is
done under the same key that the choice function leaves out. A domain that needs more
than one round of questions, such as asking about each part of an item before deciding the item, adds an `answer`
function that asks in stages; a stage can give a view function of its own.

## Write a harness

A harness is a program that runs a domain on case folders. Its setup function returns a runner. The runner holds what
every case shares, the definition, how to read a case's id, how to load a case folder's state machine, and, when the
domain has one, how a case ended, from the run's result. The definition holds what a domain lets a run vary, such as
the texts that tell the model what to do, and the limits; `run.json` records it with its hash, and each trace starts
with that hash and the case's id. The texts in the domain's code, such as those of its choices, come with the
domain's version. By default, the definition is the domain's stop text, instructions and limits, and a domain set up
from a file of its own gives that file as its definition. This setup needs nothing:

```ts
import { basename } from "node:path";
import { type Runner, runnerOf } from "@osolmaz/switch";
import { TRIAGE, triageMachine } from "./index.ts";
import { loadTicket } from "./load.ts";

export function triageSetup(): Promise<Runner> {
  return Promise.resolve(
    runnerOf({
      ...TRIAGE,
      caseId: (folder) => Promise.resolve(basename(folder)),
      load: async (folder) => triageMachine(await loadTicket(folder)),
    }),
  );
}
```

`commandLine` turns the setup into the harness's program, with switch's `run` and `replay` commands. It is a
[Commander](https://github.com/tj/commander.js) program, so the harness can add its own commands, as `legal-judge`
adds `ingest`, `score` and `compare`, and both examples add the viewer's `view`:

```ts
import { commandLine } from "@osolmaz/switch/cli";
import { triageSetup } from "./setup.ts";

await commandLine({ triage: { setup: triageSetup } })
  .name("triage")
  .parseAsync();
```

Each domain of a harness is a `DomainSetup`: its setup function, and the flags of its own, which `run` and `replay`
then take. `setup` gets their values by name. For example, `legal-judge` declares
`flags: [{ flag: "--judge <file>", description: "…" }]`, and its setup reads the judge file from `flags["judge"]`. A
harness with more than one domain takes `--domain` to pick one. The model's API key comes from the environment
variable that `--api-key-env` names, or pi-ai finds the provider's own, such as `TYPESAFE_API_KEY`.
[`examples/legal-judge/`](examples/legal-judge) and [`examples/chess/`](examples/chess) are complete harnesses, and
[docs/MATH.md](docs/MATH.md) explains the loop in symbols.

## License

[MIT](LICENSE)

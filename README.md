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
switch gives them a loop that does. At each step, your program offers the model a short list of choices, and the model
picks one. Your program carries out the choice and shows the model where the task is now, and this repeats until the
model can answer the task's questions. The name comes from a railway switch, where one track splits into a few: your
program lays the tracks, and the model sets the switch.

The task itself comes from a domain, which you write in TypeScript. For each case, a domain gives a state machine: an
initial state, a choice function that gives the choices in a state, and a transition function that gives the next
state after the model's pick. These three are the whole interface that a domain must give. Behind them, a domain may
use any library, program or data of its own, such as a chess engine. A domain may also set the questions that the
model answers at the end, and the view function, which turns a state into what the model reads. switch runs the same loop for every domain
and keeps the model's probability for every choice of every step. It fits the view into the model's window and writes
a trace of every state, which can be replayed or forked. Two example harnesses in [`examples/`](examples) use switch
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
3. The **view function** takes the state and gives the **view**, the JSON and the images that the model reads. The
   model reads the view and **picks** one choice, with a probability for every choice.
4. The **transition function** takes the state and the picked choice, does the work of the choice, and gives the next
   state. One pass of the choices, the pick and the transition is a **step**.
5. The run goes back to the choice function, until the model picks stop, the state has no choices, or the step limit
   is reached. Then the model answers the domain's **questions**, and every **answer** comes with its probabilities.

The **trace** of a run keeps every state, the choices of each step with the model's probabilities, and each pick. So
a replay reads the states from the trace and runs no transition again.

## Install

switch needs Node.js 22.13 or newer and pnpm. To use it in another project, add it pinned to a commit; installing
builds it.

```bash
pnpm add github:osolmaz/switch#<commit>
```

The package has these entry points:

| Import                    | What it gives                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@osolmaz/switch`         | The loop, the types of a domain and its state machine, the choice checks, traces and replay                 |
| `@osolmaz/switch/models`  | `piAiDecider`, which asks a classifier model that pi-ai lists                                               |
| `@osolmaz/switch/cli`     | `commandLine`, which gives a harness the `run`, `replay` and `view` commands, and the functions behind them |
| `@osolmaz/switch/viewer`  | The viewer's server side, and `DomainViewer` for a domain's own part of the page                            |
| `@osolmaz/switch/page`    | The viewer's browser side, with `registerPart` for a domain's part of the page                              |
| `@osolmaz/switch/testing` | A fake decider that answers by a rule, for tests that make no model calls                                   |

To work on switch itself, clone it and run `pnpm install`.

## Examples

Each example is a package of its own in `examples/`, with a README that says what it does, what else it needs
installed and how to run it. Its program is `src/main.ts`, which runs from the repository root.

- [Legal judge](examples/legal-judge/README.md) (`legal-judge`) grades a saved answer to a legal task against the
  task's rubric.
- [Chess](examples/chess/README.md) (`chess`) plays a game of chess against an opponent that picks random legal
  moves, against Stockfish, or against itself.

## Watch a run

`view` opens a run in the browser and plays it back step by step: each step's choices with the model's probability for
every one, the model's pick and what the step changed in the state. A domain can give its own part of the page, with
its own styles, which draws its states in its own way: a chess game gets a board with moving pieces, arrows for the
model's likeliest moves, the move list and a PGN download. Add `--view` to `run` to watch the cases while they run;
each case's page follows it live:

```bash
examples/chess/src/main.ts run examples/chess/cases/white-seed-1 --out runs/chess --view
```

The run folder keeps everything a later `view runs/chess` needs to play the cases back. `view --html <file>` saves a
case's page as one HTML file that opens without switch.

## Replay a case

`replay` runs a case again from its trace. It repeats each recorded pick and takes each state from the trace, so no
transition runs again. A replay thus gives the recorded case, even when a transition would find something else now,
such as the reply of a chess engine. It stops with an error when a recorded pick is not among the choices that the
domain's code gives now. With `--fork <n>`, `replay` takes the state after n steps from the trace, and the model that
`--model` names goes on from there, with the transitions running again:

```bash
examples/chess/src/main.ts replay examples/chess/cases/white-seed-1 runs/chess/cases/white-seed-1/trace.jsonl --fork 5
```

`run --state-from <run>` does this for every case of an earlier run: it takes each case's states from that run's
traces and asks only the questions again, for example with another definition or model.

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
    view: (state) => Promise.resolve({ json: { ticket: ticket.text, read: state.read }, images: [], omitted: [] }),
    questions: () => [
      {
        type: "choice",
        id: "team",
        instructions: "Which team should handle the ticket?",
        choices: { billing: "Billing", infra: "Infrastructure", app: "Application" },
      },
    ],
  };
}
```

The model reads the ticket and opens logs one step at a time until it picks stop, then answers the question. Each
question has a type, here a `choice`. Every answer comes with the model's probabilities. Only `initial`, `choices` and
`transition` are needed: without a view function, the model reads the state as it is, and without questions, the run asks
nothing. A choice function must leave out what the state says is done, because switch refuses a choice that the model
picked before. Any classifier model that pi-ai lists can decide, with its key from the environment:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { run } from "@osolmaz/switch";
import { piAiDecider } from "@osolmaz/switch/models";

const decider = piAiDecider("typesafe/jev-latest", { registry: builtinModels(), apiKey: process.env.TYPESAFE_API_KEY });
const result = await run(TRIAGE, triageMachine(ticket), decider);
```

`result.answers` holds the answers, and `result.state` the last state. `result.trace` holds every state, every choice
that the model saw with the probability it gave it, and each pick. `result.ended` tells why the steps ended: the model
picked stop, the state had no choices, the steps ran out, or the pick failed. A domain with several types of choice
can give each type in a file of its own with `choiceType`, and join them with `joinTypes`. A domain that needs more
than one round of questions, such as asking about each part of an item before deciding the item, adds an `answer`
function that asks in stages.

## Write a harness

A harness is a program that runs a domain on case folders. Its setup function takes a definition file, or none, and
returns a runner. The runner holds what every case shares, the definition, how to read a case's id, how to load a case
folder's state machine, and, when the domain has one, how a case ended. The definition holds every text the
model reads that does not come from a case, and the limits; `run.json` records it with its hash. `--definition <file>`
passes a file to the function, such as a judge file to `legal-judge`. This setup takes no file:

```ts
import { basename } from "node:path";
import { DefinitionError, definitionOf, type Runner, runnerOf } from "@osolmaz/switch";
import { TRIAGE, triageMachine } from "./index.ts";
import { loadTicket } from "./load.ts";

export function triageSetup(file: string | undefined): Promise<Runner> {
  if (file !== undefined) return Promise.reject(new DefinitionError("triage takes no definition file"));
  return Promise.resolve(
    runnerOf({
      ...TRIAGE,
      definition: definitionOf("triage", {
        stop: TRIAGE.stop,
        instructions: TRIAGE.instructions,
        limits: { ...TRIAGE.limits },
      }),
      caseId: (folder) => Promise.resolve(basename(folder)),
      load: async (folder) => triageMachine(await loadTicket(folder)),
    }),
  );
}
```

`commandLine` turns the setup into the harness's program, with switch's `run`, `replay` and `view` commands. It is a
[Commander](https://github.com/tj/commander.js) program, so the harness can add its own commands, as `legal-judge`
adds `ingest`, `score` and `compare`:

```ts
import { commandLine } from "@osolmaz/switch/cli";
import { triageSetup } from "./setup.ts";

await commandLine({ triage: { setup: triageSetup } })
  .name("triage")
  .parseAsync();
```

Next to `setup`, a domain can name its part of the viewer. That part is a `DomainViewer`: browser modules that call
`registerPart` with hooks for the stage, the bars beside it, a list of the steps, the result's score, a download and
sounds, the stylesheets that draw them, and the config they start with. It can also give a summary of a case's
outcome, a short line for the list of cases and the result's banner. The hooks read the states. Every hook is
optional. The page marks the document with the case's domain, so a stylesheet can restyle the page for its own cases
under `:root[data-domain="<domain>"]`, as chess gives its cases chess.com's colors. A harness with more than one domain
takes `--domain`
to pick one. [`examples/legal-judge/`](examples/legal-judge) and [`examples/chess/`](examples/chess) are complete
harnesses, and [docs/2026-10-25-switch-plan.md](docs/2026-10-25-switch-plan.md) explains the design.

## License

[MIT](LICENSE)

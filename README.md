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
switch gives them a loop that does. At each step, your program offers the model a menu, a short list of possible next
steps, and the model picks one choice from it. Your program carries out that choice and shows the model what it found,
and this repeats until the model can answer the task's questions. The name comes from a railway switch, where one
track splits into a few: your program lays the tracks, and the model sets the switch.

The task itself comes from a domain, which you write in a few small pieces of TypeScript. Its center is the menu: a
function that looks at the world of one case and at the history of the run so far, and returns the choices that make
sense now. A domain also sets the questions the model answers at the end, and the view, which shows the world and the
history to the model. switch runs the same loop for every domain and keeps the model's probability for every choice on
every menu. It fits the view into the model's window and writes a trace of every step, which can be replayed or
forked. Two example harnesses in [`examples/`](examples) use switch the way another project would: `legal-judge`,
which grades answers to legal tasks against a rubric, and `chess`. The same loop fits any task where a model should
look around before it decides, such as routing a support ticket after reading its logs or deciding whether a report
needs a person.

## How it works

A run of one case goes like this:

1. The domain loads the **world** of the case: everything the case gives, fixed for the run, such as a task and its
   files, or a chess position, a side and an opponent.
2. The **menu** function takes the world and the **history**, the steps taken so far, and returns the **choices** for
   this step. Each choice has a text that the model reads, a key, and code that runs it. switch removes the choices
   already taken, cuts the menu to its limit and adds stop.
3. The model reads the **view**, the JSON **state** that the domain builds from the world and the history, and picks
   one choice, with a probability for every choice on the menu.
4. switch runs the choice and adds a **step** to the history: the choice's **kind**, such as `read` or `move`, its
   key, and its **observation**, what it found.
5. The run goes back to the menu, until the model picks stop, the menu is empty, or the step limit is reached. Then
   the model answers the domain's **questions**, and every **answer** comes with its probabilities.

A choice only reads the world. Everything that changes goes into the history, so the menu at any step follows from
the world and the history alone, and a trace holds all a replay needs.

## Install

switch needs Node.js 22.13 or newer and pnpm. To use it in another project, add it pinned to a commit; installing
builds it.

```bash
pnpm add github:osolmaz/switch#<commit>
```

The package has these entry points:

| Import                    | What it gives                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@osolmaz/switch`         | The loop, menus, traces, replay and the types of a domain and its setup                                     |
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

`view` opens a run in the browser and plays it back step by step: each step's menu with the model's probability for
every choice, the model's choice and what it found. A domain can give its own part of the page, which draws its steps
in its own way: a chess game gets a board with moving pieces, arrows for the model's likeliest moves, the move list
and a PGN download. Add `--view` to `run` to watch the cases while they run; each case's page follows it live:

```bash
examples/chess/src/main.ts run examples/chess/cases/white-seed-1 --out runs/chess --view
```

The run folder keeps everything a later `view runs/chess` needs to play the cases back. `view --html <file>` saves a
case's page as one HTML file that opens without switch.

## Replay a case

`replay` runs a case again from its trace. It repeats each recorded choice and takes each step's observation from the
trace, so it runs no choice again. A replay thus gives the recorded case, even when a choice would find something
else now, such as the reply of a chess engine. A step that looked at an image runs again, because a trace keeps only
the image's label; if that step finds something else, the replay stops with an error. With `--fork <n>`, `replay`
repeats the first n steps, and the model that `--model` names goes on from there:

```bash
examples/chess/src/main.ts replay examples/chess/cases/white-seed-1 runs/chess/cases/white-seed-1/trace.jsonl --fork 5
```

`run --steps-from <run>` does this for every case of an earlier run: it repeats each case's steps from that run's
traces and asks only the questions again, for example with another definition or model.

## Write a domain

A domain's menu lists the choices that make sense now, from the world and the history, and says what running one
finds. `choiceKind` builds the menu of one kind of choice with a typed argument, and `joinMenus` puts the menus of
several kinds together. This domain routes a support ticket and lets the model read the ticket's logs first:

```ts
import { choiceKind, type Domain } from "@osolmaz/switch";

interface Ticket {
  readonly text: string;
  readonly logs: Readonly<Record<string, string>>;
}

const readLog = choiceKind<Ticket, string>({
  name: "read-log",
  menu: (ticket) => Object.keys(ticket.logs).map((name) => ({ key: name, text: `Read ${name}`, arg: name })),
  run: (ticket, name) => ({ source: name, text: ticket.logs[name] ?? "" }),
});

export const triage: Domain<Ticket> = {
  name: "triage",
  version: "0.1.0",
  menu: readLog,
  stop: "Stop reading: the evidence is enough",
  instructions: "Which log should be read next to route this ticket?",
  questions: () => [
    {
      type: "choice",
      id: "team",
      instructions: "Which team should handle the ticket?",
      choices: { billing: "Billing", infra: "Infrastructure", app: "Application" },
    },
  ],
  start: (ticket) => Promise.resolve([{ kind: "start", key: "ticket", observation: { text: ticket.text } }]),
  view: (_ticket, history) => ({
    state: {
      evidence: history.map(({ observation }) => ({ source: observation.source ?? "", text: observation.text })),
    },
    images: [],
    omitted: [],
  }),
};
```

The model reads the ticket and opens logs one step at a time until it picks stop, then answers the question. Each
question has a type, here a `choice`. Every answer comes with the model's probabilities. Any classifier model that
pi-ai lists can decide, with its key from the environment:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { run } from "@osolmaz/switch";
import { piAiDecider } from "@osolmaz/switch/models";

const decider = piAiDecider("typesafe/jev-latest", { registry: builtinModels(), apiKey: process.env.TYPESAFE_API_KEY });
const result = await run(triage, ticket, decider, { case: "ticket-1" });
```

`result.answers` holds the answers, and `result.history` the steps. `result.trace` holds every menu the model saw with
the probability it gave each choice, and what each step found. `result.ended` tells why the model stopped choosing
steps: it chose stop, the menu was empty, the steps ran out, or a choice failed. A domain that needs more than one
round of questions, such as asking about each part of an item before deciding the item, adds an `answer` function
that asks in stages.

## Write a harness

A harness is a program that runs a domain on case folders. Its setup function takes a definition file, or none, and
returns a runner: the domain, its definition and limits, how to read a case folder, and, when the domain has one, how
a case ended. The definition holds every text the model reads that does not come from a case, and the limits;
`run.json` records it with its hash. `--definition <file>` passes a file to the function, such as a judge file to
`legal-judge`. This setup takes no file:

```ts
import { basename } from "node:path";
import { DEFAULT_LIMITS, definitionOf, type Runner, runnerOf, SetupError } from "@osolmaz/switch";
import { triage } from "./index.ts";
import { loadTicket } from "./load.ts";

export function triageSetup(file: string | undefined): Promise<Runner> {
  if (file !== undefined) return Promise.reject(new SetupError("triage takes no definition file"));
  return Promise.resolve(
    runnerOf({
      domain: triage,
      definition: definitionOf("triage", { stop: triage.stop, instructions: triage.instructions }),
      limits: DEFAULT_LIMITS,
      caseId: (folder) => Promise.resolve(basename(folder)),
      load: loadTicket,
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
sounds, and the config they start with. Every hook is optional. A harness with more than one domain takes `--domain`
to pick one. [`examples/legal-judge/`](examples/legal-judge) and [`examples/chess/`](examples/chess) are complete
harnesses, and [docs/2026-10-25-switch-plan.md](docs/2026-10-25-switch-plan.md) explains the design.

## License

[MIT](LICENSE)

---
title: Domains as examples outside switch
author: Onur Solmaz
date: 2026-10-28
---

# Domains as examples outside switch

## TL;DR

switch's two domains, legal-judge and chess, should show how a project outside switch builds a harness on it. Today
switch holds them, their data, the legal-judge scoring and the chess viewer, and the core still uses legal-judge words
such as workspace, judge and evidence, plus two words, option and action, for one idea. Three PRs fix this: the first
renames the core's words to world, history, action and answer and removes two legal-judge fields, the second splits
the viewer so that chess gives its own part of the page, and the third moves each domain into `examples/<name>/` as a
package that imports `@osolmaz/switch` the way an outside project would. `result.json` files from before stay
readable, old traces and `run.json` files need some fields renamed with the `jq` commands in this doc, and the
commands move to each example's entry point.

## Background

switch lets a decision model work through a case by picking steps from a menu that code builds, and then answer
questions. A domain says what the steps and the questions are, and the core runs the loop.
[PR #24](https://github.com/osolmaz/switch/pull/24) gave each domain a `setup.ts` in its own folder
([design](2026-10-27-domain-setup-and-replay.md)).

The two domains have one purpose: each shows how a project outside switch builds a harness on it. Here a harness is
a program that gives switch one or more domains and runs them on case folders. legal-judge grades a saved answer to
a legal task against its rubric. chess plays a game against a random opponent, against Stockfish, or against itself.

The repository does not show that today. The domains sit in `src/domains/`, beside the core, and import it by a
relative path. Their data sits in two top-level folders with two different patterns: `judges/` holds the legal-judge
definition files, and `examples/chess/` holds the chess cases. switch's command line, its scoring and its viewer each
know one of the domains.

## Problems

### Legal-judge names in the core

The core was written when legal-judge was the only domain. Some of its names describe a legal grading task, and they
do not fit chess.

| Name                      | Where                                                                                                     | Why it does not fit                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace`               | `State.workspace`, `ActionSpec.observe`, `Domain.questions`, `Domain.start`, `run`, `Setup` in `src/core` | It means the folder of files that an agent left. In chess it is the start position, the side, the opponent and the engine.               |
| `judge`, `JudgeContext`   | `Domain.judge?` in `src/core/types.ts`                                                                    | The hook is the domain's own way to get its answers. Chess judges nothing.                                                               |
| "evidence"                | `gather` in `src/core/loop.ts`, the comments on `Ending`, `Domain.stop` and `AskOptions`                  | The steps of a chess game are moves.                                                                                                     |
| `informs`                 | `Option.informs`, `MenuItem.informs` and the trace's menu options                                         | Only the legal-judge `search` action sets it, and nothing in switch reads it.                                                            |
| `source`                  | `Observation.source`, which every observation must have                                                   | Chess writes `"board"` on every observation. Only the legal-judge view reads it.                                                         |
| `rejudge`, `evidenceFrom` | the `rejudge` command and `run.json`                                                                      | The command repeats each case's recorded steps and asks the questions again. It has the options of `run`, plus `--from`, minus `--view`. |
| `log`                     | `State.log` and `RunResult.log`                                                                           | Most readers take a log for debug output, and `src/cli` already has a `log` that prints progress lines.                                  |
| "option" and "action"     | `Option`, `MenuItem` and `Action` in `src/core`, the trace's `menu.options`, and `Limits.options`         | Two words for one idea: a step that the model can take is an "option", and the code that lists such steps is an "action".                |

The model's API has its own words for the question and the pick. The section on the model's words below lists them
next to switch's words.

### switch holds the domains

- `src/cli/domains.ts` imports `chessSetup`, `legalJudgeSetup` and the legal-judge ingester. `--domain` says
  "legal-judge or chess", and legal-judge is the default.
- `ingest` reads the legal-judge input layout: `request.md`, `rubric.json`, `documents/` and `answer/`.
- switch's `package.json` lists the domains' dependencies: `chess.js` for chess, and `pdfjs-dist`, `postal-mime`,
  `@xmldom/xmldom` and `fflate` for the legal-judge ingest.
- `package.json` has no `exports`, so a project outside cannot import switch. The domains import
  `../../core/index.ts`.
- `packageRoot` in `src/core/root.ts` finds `judges/` and `assets/` beside the package. The core does not use it.

### The scoring belongs to legal-judge

`src/eval/score.ts` scores a run against labels. A label is `{ id, items: [{ id, pass }] }`, the expected verdict of
each rubric item. The report gives item accuracy, kappa, false passes and false fails, and a case passes only when
every item passes. The `score` and `compare` commands, the `labels` field of an eval set in `src/cli/sets.ts`, and the
`categories` field of `Setup`, `CaseRun` and `result.json` exist only for this scoring. Chess has no questions and no
labels. Its result is the outcome that its setup reports.

PR #24 kept `categories` as a shared field because `score` seemed to work for any domain. It does not, so that reason
does not hold.

### The viewer draws chess

`src/view` turns a trace into a web page, and about half of it is chess:

- `src/view/web/board.ts` and `src/view/web/sound.ts`.
- The chess half of `src/view/web/model.ts`: `chessStep`, `chessOption`, `piecesOf`, `play`, `samePlaces`,
  `captures`, `pliesOf`, `scoreOf` and `pgnOf`.
- The chess half of `src/view/web/panels.ts`: the arrows, the check square, `positionOf`, the side to move, the move
  list and the player bars.
- The parts of `src/view/web/app.ts` that draw and animate the board, play the sounds, and show the Sound and PGN
  buttons.
- `src/view/pieces.ts`, `src/view/sounds.ts` and `assets/`.

The page also reads the chess step data with its own copy of the format that `src/domains/chess/move.ts` writes, so
the type checker cannot catch a change on one side.

## Plan

Three PRs, in this order. Each one passes `pnpm check` and leaves switch working.

1. **Names in the core.** Rename the legal-judge words, call the log the history, use one word, action, for a step
   that the model can take, drop `informs`, make `source` optional, and fold `rejudge` into `run`. Small changes in
   many files, and no files move.
2. **Viewer split.** switch's viewer shows any domain, and chess gives its board, sounds, move list and PGN as its own
   part of the page.
3. **Domains as packages.** Each domain becomes a package in `examples/<name>/` with its code, data, tests and entry
   point, and switch becomes a package with `exports`.

The viewer split comes before the packages. After it, switch's viewer and its tests need no domain, so the third PR
moves folders and wires entry points, and changes no viewer code.

## Names in the core

### World

`workspace` becomes `world` everywhere in the core. The world is what one case gives, loaded once and fixed for the
run. Everything that changes goes into the history, so the state of a run is the world plus the history.

- `State<W>` is `{ world, history }`.
- An action's `run(world, arg)`, and its comment says "Actions only read the world."
- `Domain.questions(world)` and `Domain.start(world)`.
- `run(domain, world, decider, options)` and `startOf(domain, world, replay)`.
- `Setup.load(folder)` returns "the world of a case folder", and `Setup.outcome(world, result)`.

The type parameter stays `W`. legal-judge renames its `Workspace` type to `World`, `workspace.ts` to `world.ts` and
`makeWorkspace` to `makeWorld`, so that the example reads like the core. Chess keeps its own name, `ChessGame`.

Names considered:

- `case` is the most exact word. It already names the case id in `result.json`, in the trace and in `CaseRun`, and it
  cannot be a variable name in JavaScript.
- `environment` already means environment variables in this code (`STOCKFISH`, `--api-key-env`). In reinforcement
  learning an environment also changes at each step, and the world does not.
- `world` can make a reader expect it to change. The docs say that it does not, and that the chess board comes from
  the history.

### History

`log` becomes `history`. The history is the list of steps taken so far in a run, in order. Each entry records which
kind of action ran, its key, and its observation. The domain's `start` adds the opening entries, the core adds one
entry after each step, and nothing else changes the history.

- `State<W>` is `{ world, history }`, and `RunResult.log` becomes `RunResult.history`.
- The domains' helpers take `history`, such as `movesOf(history)` in chess and `readParts(history)` in legal-judge.
- No file on disk has a `log` field, so this rename changes no file.

Names considered:

- `steps` already means the number of steps, in `RunResult.steps` and `Limits.steps`.
- `trajectory` is jargon, and it sounds like a finished run.

### Actions

switch uses one word, action, for a step that the model can take now: "Nc6 (knight b8 to c6)", "Read contract.pdf,
part 2", or stop. The word "option" leaves the code and the docs. "Read", "search" and "move" become each action's
`kind`, a label that the trace and the viewer can group by.

A domain gives one function that returns the available actions:

```ts
interface Action {
  /** A label such as "move" or "read". */
  readonly kind: string;
  /** Unique in a run, such as "move:0:e2e4"; an action whose key is in the history is not offered again. */
  readonly key: string;
  /** What the model reads. */
  readonly text: string;
  /** Lower keeps the action when the menu must be cut; 0 by default. */
  readonly priority: number;
  readonly data?: JsonObject;
  run(): Promise<Observation>;
}

interface Domain<W> {
  actions(state: State<W>): readonly Action[];
  // the rest stays as it is
}
```

The helper `actionKind` keeps today's typed argument. It turns a kind's spec into a function from the state to that
kind's actions, and a domain joins its kinds in the order it wants them on the menu:

```ts
// chess: one kind
const move = actionKind<ChessGame, Play>({
  name: "move",
  list(state) {
    const before = movesOf(state.history);
    const board = replay(state.world.start, before);
    if (statusOf(board) !== "playing") return [];
    return board.moves({ verbose: true }).map((legal) => ({
      key: `${String(before.length)}:${legal.lan}`,
      text: describe(legal),
      arg: { before, lan: legal.lan },
    }));
  },
  run: play,
});
// in the domain: actions: move

// legal-judge: six kinds, in menu order
// in the domain: actions: (state) => [read, look, search, count, changes, compare].flatMap((kind) => kind(state))
```

What changes:

- `MenuItem` and `Option<A>` become `Action`. Today's `Action<W>`, the code that lists one kind, becomes a function
  that `actionKind` returns. `action()` becomes `actionKind()`, and its spec's `options` and `observe` become `list` and
  `run`.
- `Domain.actions` is a function in place of a list. The core keeps doing what `buildMenu` does today with the actions
  that it returns: it removes the actions whose key is in the history, refuses two actions with the same key or text,
  cuts the list to the limit by priority, and adds stop.
- `Entry.action` becomes `Entry.kind`. Stop is an action with the kind and the key `stop`.
- `Limits.options` becomes `Limits.actions`: the most actions on one menu, stop included.
- The menu keeps its name: it is the list of available actions at one step.
- The trace's menu entries list `actions` in place of `options`, each with `kind` in place of `action`. Observation
  entries have `kind` in place of `action`. The `case` entry and `run.json` have `limits.actions` in place of
  `limits.options`.
- The legal-judge files in `judges/` and the chess definition have `limits.actions`, so both definition hashes change,
  and so does the legal-judge version, which includes the judge's hash. The menus and the requests to the model do not
  change.

### Words on the model's side

The core sends the available actions to the model as one question. With Jev, TypeSafe's classifier model and
switch's default, the request goes through pi-ai's classifier API. pi-ai sends each question to TypeSafe's
`/systemone` endpoint as it is, except that it renames `bool` to `noul` (`dist/api/system-one-shared.js` in pi-ai
1.4.0). These are the words on each side; TypeSafe's own documentation was not checked.

| switch                                                                          | pi-ai and TypeSafe                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| the JSON that the model reads, `View.state`                                     | `state`                                                                           |
| `ChoiceQuestion`, with `kind: "choice"`                                         | a question with `type: "choice"`                                                  |
| each available action, as a label `o1`…`oN` or `stop`, with the action's `text` | a key of the question's `criteria`, with its text                                 |
| `choices`, `levels`, and `yes` and `no`                                         | `criteria` for each of the three question types                                   |
| `bool`                                                                          | `bool` in pi-ai, and `noul` on TypeSafe's wire                                    |
| the model's pick: `ChoiceAnswer.choice` and `probabilities`                     | `choice` and `probabilities`, plus a `confidence` that switch does not keep today |
| `Decider` and `decide`                                                          | a classifier model and `classify`                                                 |

So "choice" has one meaning in switch, as on the model's side: the model's pick in a choice question. What the model
picks is an action. On the model's side an action is only a label with a text, and `choose` in `src/core/loop.ts`
turns the actions into labels and the picked label back into its action.

### Answer

`Domain.judge?` becomes `Domain.answer?`, and `JudgeContext` becomes `AnswerContext`. Without the hook, the core asks
the questions once over the view. With it, the domain asks them in stages of its own. legal-judge keeps its function
`judgeWith(definition)`, because in legal-judge it is a judge. The comment on `AskError` says "an answer stage", and
the trace's `asked` entries keep their stage names.

### Steps

The word "evidence" leaves the core. `gather` becomes `takeSteps`, `Domain.stop` is "the text of the stop action", and
the comments on `AskOptions` say "the view" for "the evidence view". This changes comments and one function name, and
no behavior.

### Informs into data

`Option.informs` and `MenuItem.informs` go, and so does `informs` on the trace's menu entries. legal-judge's `search`
puts the rubric items of a term into the action's data: `data: { informs: term.items }`. PR #24 added `data` for facts
like this, which tools read and the model never sees.

### Optional source

`Observation.source` becomes optional. The trace writes it only when an observation has one, and replay compares
`source ?? null`. Chess stops writing `"board"`. legal-judge keeps a source on every observation, because its view
lists the sources for the model.

### Steps from another run

The `rejudge` command goes, and `run` gets `--steps-from <run>`. Each case repeats the steps and observations that
the other run recorded for it, and then the model answers the questions. This is what `rejudge --from` does today.

- `run.json` records `stepsFrom` in place of `evidenceFrom`.
- `RunCasesOptions.evidenceFrom` becomes `stepsFrom`, and the helper `evidence()` in `src/cli/commands.ts` becomes
  `stepsOf()`.
- `compare` prints "steps of <run>" for "evidence of <run>".

### What stays the same

- The requests that both domains send to the model stay byte for byte the same. The legal-judge view still lists
  each observation's source, and the chess view never showed it. The menus have the same actions in the same order.
- The chess version and the question and answer types stay the same.
- The trace keeps its entry types and the keys of every step. Only the field names above change, and the migration
  section gives the `jq` commands that rename them in an old trace and an old `run.json`. The reader does not accept
  the old names.

What changes besides the names: both definition hashes and the legal-judge version, because `limits.options` is
renamed in both definitions.

### Tests

- The existing tests, with the new names.
- A domain's `actions` function is the menu's only source: the core keeps its order, removes the actions already
  taken, and cuts by priority.
- The trace's menu entries list `actions` with a `kind`, observation entries have a `kind`, and `limits` has
  `actions`.
- A legal-judge search action carries `informs` in its `data`, and the trace's menu entries have no `informs` field.
- An observation without a source is written without one, and a replay of it passes.
- A trace that the migration's `jq` command renamed loads in the viewer and replays.
- `run --steps-from` tests replace the `rejudge` tests: the recorded steps come back, and only the answers go to the
  model.
- A check before the merge: the requests for a test case of each domain are byte for byte the same as on `main`.

## Viewer split

switch's viewer shows the run of any domain. A domain may also give a part of the page that draws its steps in its
own way. Chess gives the board and its other chess parts.

### What stays in switch

- The server side: `frames.ts`, which turns a trace into a story, `page.ts`, the index page, `serveRun` and the live
  updates.
- On the page: the header, playback at four speeds and with the arrow keys, the step label, the menu with each
  action's probability, "What happened", the notes, the confidence chart, and the result panel with the outcome and
  the answers.
- When a domain gives no part, the stage shows the observation text, as the page does today for a step without chess
  data.

### What moves to chess

In this PR the chess part lives in `src/domains/chess/web/` (the browser modules) and `src/domains/chess/viewer.ts`
(the server side). The folder name `web` keeps it apart from `src/domains/chess/view.ts`, which builds what the model
reads. The third PR moves it with the rest of chess.

- `board.ts` and `sound.ts`.
- From `model.ts`: `chessStep`, `chessOption`, `piecesOf`, `play`, `samePlaces`, `captures`, `pliesOf`, `scoreOf`,
  `pgnOf` and their helpers.
- From `panels.ts`: the arrows, the check square, `positionOf`, the side to move, the move list with figurines, and
  the player bars.
- From `app.ts`: drawing and animating the board, the move and end sounds, the Sound and PGN buttons, and the player
  names.
- `src/view/pieces.ts` and `src/view/sounds.ts`, which become part of `src/domains/chess/viewer.ts`.
- `assets/pieces/` and `assets/sounds/`, to `src/domains/chess/assets/`. Until the third PR they are found with
  `packageRoot`, so that they load from the sources and from `dist/`.

### The domain's part of the page

A domain's part has two halves. On the server, a `DomainViewer` names the browser modules of the part, in order, and
gives the JSON that they start with:

```ts
interface DomainViewer {
  /** The part's browser modules, each after the ones it uses. */
  readonly modules: readonly URL[];
  /** What the part starts with; for chess, the piece images and the sound clips. */
  config(): Promise<JsonObject>;
}
```

In the browser, the part registers an object with hooks under its domain's name, and switch's page calls the hooks
that the object has:

| Hook                             | What it does                                                    | Chess                                       |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `stage(moment, motion)`          | draws the stage for a moment, and moves to it from the last one | the board, the arrows, the moves and sounds |
| `bars(moment)`                   | what goes above and below the stage                             | each player's bar with the pieces taken     |
| `stepNote(moment)`               | text after the step label                                       | "white to move"                             |
| `stepList(session, index, open)` | a list of the steps beside the stage                            | the move history                            |
| `score(session)`                 | a short result for the banner                                   | `1-0`                                       |
| `ending(session)`                | the sound at the end of the case                                | checkmate, draw or game over                |
| `download(session)`              | a file that the page offers                                     | the game as PGN                             |

The viewer PR settles the exact signatures, with tests. The CLI gives each domain's viewer to `view` and `run --view`
beside its setup: each entry of the list in `src/cli/domains.ts` becomes `{ setup, viewer? }`.

### How the page is built

The page has no bundler. `src/view/bundle.ts` strips the types of each browser module, removes the imports and
exports, and joins the modules into one script. A domain's modules come after switch's modules. They call switch's
helpers, such as `h`, by name, and they import them only for the type checker. The bundler drops those imports, as it
drops the imports between switch's own modules today. Top-level names stay unique across the whole script.

### Step data in one place

The chess step data gets one type and one check, in `src/domains/chess/web/data.ts`. The domain's `move.ts` writes
data of that type, and the page reads it with that check. The module imports nothing, so it runs in the browser as it
is. It replaces the copy of the format in `src/view/web/model.ts`.

### Boundaries in this PR

`src/view` still imports only `src/core`. `src/domains/chess` may also import `src/view`, for the viewer's types and
helpers. `src/cli` imports the chess viewer to wire it.

### Tests

- switch's viewer tests use sessions from the test domain in `tests/helpers/fakes.ts`. Without a domain part, the page
  shows the observation text, the menu with the probabilities, the chart, the answers and the outcome.
- The board, sound, move list and PGN tests move to `tests/domains/chess/`, with `tests/helpers/sessions.ts` and
  `tests/helpers/audio.ts`, and they run through the chess part.
- A page with the chess part shows the board, as `tests/view/app.test.ts` checks today.
- The page script still builds from the sources and from `dist/`.

## Domains as packages

### Layout

```text
switch/
├── src/                  switch only: core, models, cli, view, testing
├── tests/                switch's tests
├── examples/
│   ├── chess/
│   │   ├── package.json
│   │   ├── README.md
│   │   ├── src/          the domain, its setup, its part of the viewer, main.ts
│   │   ├── cases/        the 5 case folders that are in examples/chess/ today
│   │   ├── assets/       the pieces and the sounds
│   │   └── tests/
│   └── legal-judge/
│       ├── package.json
│       ├── README.md
│       ├── src/          the domain, its setup, actions/, ingest/, score/, main.ts
│       ├── judges/       the 2 files that are in judges/ today
│       └── tests/
└── docs/
```

`judges/`, `assets/`, `src/domains/` and `src/eval/` go. `examples/` holds only packages.

### switch as a package

`pnpm-workspace.yaml` gets `packages: ["examples/*"]`. Each example depends on `"@osolmaz/switch": "workspace:*"`
and imports switch only through that package name.

switch's `package.json` gets `exports`:

| Import                    | What it gives                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@osolmaz/switch`         | the core: the types, `actionKind`, `run`, the trace, replay, `Setup`, `runnerOf` and `definitionOf`    |
| `@osolmaz/switch/cli`     | `commandLine`, and the readers of run folders and eval sets: `readRunRecord`, `readResults`, `loadSet` |
| `@osolmaz/switch/viewer`  | `DomainViewer`, and the page's types and helpers for a domain's part                                   |
| `@osolmaz/switch/testing` | the fake decider for tests, which moves from `tests/helpers/fakes.ts` to `src/testing/`                |

Each entry has three conditions:

```json
".": {
	"switch-source": "./src/core/index.ts",
	"types": "./dist/src/core/index.d.ts",
	"default": "./dist/src/core/index.js"
}
```

- In this repository the examples run switch from its TypeScript sources, through the `switch-source` condition.
  pnpm links the workspace package, and Node follows the link to a path outside `node_modules`, so Node strips the
  types. I checked this with Node 22.23: with the condition, an import of a linked package's `.ts` entry runs; without
  it, Node takes `default`; and with `--preserve-symlinks`, Node refuses to strip types under `node_modules`.
- A project that installs switch from Git gets the build in `dist/`, which `prepare` makes.
- The condition has its own name, because some published packages point a `source` condition at TypeScript files,
  and Node cannot run those from `node_modules`.
- `tsconfig.json` sets `customConditions: ["switch-source"]`, and `vitest.config.ts` resolves the same condition.

### A harness's command line

`@osolmaz/switch/cli` exports `commandLine(domains)`. It takes the harness's domains by name, each with its setup
function and, if it has one, its viewer. It returns the program with `run`, `replay` and `view`, and a harness can
add its own commands before it parses the arguments. `--domain` picks one of the harness's domains. With only one
domain, the flag is not needed.

Each example has one entry point, `src/main.ts`, which is executable:

```ts
#!/usr/bin/env -S node --conditions=switch-source
import { commandLine } from "@osolmaz/switch/cli";
import { chessSetup } from "./setup.ts";
import { chessViewer } from "./viewer.ts";

await commandLine({ chess: { setup: chessSetup, viewer: chessViewer } }).parseAsync();
```

```bash
examples/chess/src/main.ts run examples/chess/cases/white-seed-1 --out runs/chess --view
examples/legal-judge/src/main.ts run --set sets/quick.json --out runs/quick
```

The repository's rules allow no dynamic `import()`, so switch cannot load a domain from a path that a flag names. The
entry point imports its domains itself, and the type checker sees the whole harness.

switch keeps no `bin`. A `switch` command without domains could only show runs, and each harness's `view` does that.

### What moves into legal-judge

- The code in `src/domains/legal-judge/`, to `examples/legal-judge/src/`.
- `judges/legal-judge.json` and `judges/legal-judge-qualifiers.json`, to `examples/legal-judge/judges/`.
  `DEFAULT_JUDGE` comes from `new URL("../judges/legal-judge.json", import.meta.url)`. The examples run only from
  their sources, so they need no `packageRoot`.
- `ingest`, as a command that the legal-judge entry point adds, with the same arguments as today.
- `src/eval/score.ts` and `src/cli/scores.ts`, to `examples/legal-judge/src/score/`, with the `score` and `compare`
  commands. They read run folders with switch's readers.
- `categories`. The scoring reads the category of each rubric item from the case folders of the eval set.
- The dependencies `pdfjs-dist`, `postal-mime`, `@xmldom/xmldom`, `fflate` and `zod`.
- The tests: `tests/domains/legal-judge/`, `tests/eval/score.test.ts`, the scoring and ingest tests in
  `tests/cli/commands.test.ts`, and the fixture helpers `tests/helpers/cases.ts` and `tests/helpers/office.ts`.

### What moves into chess

- The code in `src/domains/chess/`, with its part of the viewer and its assets, to `examples/chess/src/` and
  `examples/chess/assets/`. The pieces keep their license file.
- The 5 case folders, from `examples/chess/<case>/` to `examples/chess/cases/<case>/`.
- The dependencies `chess.js` and `zod`.
- The tests in `tests/domains/chess/` and the helpers that only chess uses.

### What switch drops or changes

- `src/domains/`, `src/eval/`, and `src/cli/domains.ts` with `DomainError`, `INGESTERS` and the list of domains.
- `Setup.categories`, `CaseRun.categories`, and `categories` in `result.json`.
- `labels` in the eval set. switch's set file holds `name`, `cases` and `ids`, and its schema allows more fields, so
  that a harness can add its own. legal-judge's scoring reads `labels` from the same file, so today's set files work
  for both without a change.
- `packageRoot` leaves the core. Only `src/cli/source.ts` still uses it, to find switch's own `package.json` and Git
  commit, so it moves to `src/cli`.
- The `bin`, and `judges` and `assets` in `files`.
- The dependencies that moved to the examples.

### Checks

`pnpm check` checks switch and both examples, and CI runs it as it does today.

- `tsconfig.json` includes `examples`, with the condition.
- `vitest.config.ts` also runs `examples/*/tests/**/*.test.ts`. Coverage also counts `examples/*/src/**`, without the
  entry points, and the gate stays at 85%.
- An ESLint `no-restricted-imports` rule refuses an import by path from an example into `src/`. The examples reach
  switch only through `@osolmaz/switch`.
- In `slophammer.yml`, each example may import only its own folder, and switch's rules lose the domain entries. The
  DRY scan also covers `examples`.
- CI still installs `poppler-utils` and `netpbm`, which the legal-judge ingest tests use.

### Docs

- The README describes switch, links each example, and shows an entry point in "Write a domain".
- Each example's README moves with it and gets the new commands.
- `AGENTS.md` gets the boundaries for `src/` and `examples/`, the words world, history and action, and the
  `switch-source` condition.
- `docs/2026-10-25-switch-plan.md` links this doc.
- Dated docs stay as they are, because they describe the repository on their date.

## Migrations and breaking changes

Each change replaces the old contract in place. No old name, command or reader stays.

| Before                                     | After the PR    | What to do                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `result.json`                            | any             | Nothing.                                                                                                                                                                                                                                                                               |
| A trace                                    | names           | Rename its fields with the first `jq` command below. The viewer, `replay` and `run --steps-from` read traces.                                                                                                                                                                          |
| A `run.json`                               | names           | Rename its fields with the second `jq` command below. A `run.json` from before PR #24 also needs `judge` renamed to `definition`, and its inner `definition` to `content`. Only run continuation and `compare` read it.                                                                |
| A definition file of your own              | names           | Rename `limits.options` to `limits.actions`. Its hash changes.                                                                                                                                                                                                                         |
| `switch rejudge --from <run> …`            | names           | `run --steps-from <run> …`                                                                                                                                                                                                                                                             |
| `switch run --domain chess …`              | packages        | `examples/chess/src/main.ts run …`                                                                                                                                                                                                                                                     |
| `switch run …` for legal-judge             | packages        | `examples/legal-judge/src/main.ts run …`                                                                                                                                                                                                                                               |
| `switch ingest`, `score` or `compare`      | packages        | The same command on `examples/legal-judge/src/main.ts`.                                                                                                                                                                                                                                |
| `switch view <run>`                        | packages        | `view <run>` on the entry point of the example that made the run.                                                                                                                                                                                                                      |
| `switch replay …`                          | packages        | `replay …` on that entry point.                                                                                                                                                                                                                                                        |
| An eval set file                           | packages        | Nothing.                                                                                                                                                                                                                                                                               |
| A path into `judges/` or `examples/chess/` | packages        | `examples/legal-judge/judges/` and `examples/chess/cases/`.                                                                                                                                                                                                                            |
| A domain written outside this repository   | names, packages | Rename `workspace` to `world`, `log` to `history` and `judge` to `answer`. Turn the list of actions into one `actions` function with `actionKind`, whose spec has `list` and `run`. Move `informs` into `data`, import `@osolmaz/switch`, and write an entry point with `commandLine`. |

The two `jq` commands rename the fields of one case's trace and of a run's `run.json`. They write new files, and you
replace the old files after a check. They drop `informs`, which nothing reads. The trace command was tried on a copy
of a chess run: it kept all 22 entries and left no `options` or `action` field.

```bash
jq -c '
  if .type == "case" then .limits |= (.actions = .options | del(.options))
  elif .type == "menu" then .actions = [.options[] | {key, kind: .action, text} + (if .data == null then {} else {data} end)] | del(.options)
  elif .type == "observation" then .kind = .action | del(.action)
  else . end' trace.jsonl > trace.renamed.jsonl

jq '.limits |= (.actions = .options | del(.options)) | .stepsFrom = .evidenceFrom | del(.evidenceFrom)' run.json > run.renamed.json
```

## Out of scope

- Publishing switch to npm. The package stays private, and a Git install gets the build.
- A scorer for every domain. switch gets one when a second domain needs labels.
- A repository for each example.
- The word `state` for two things: the JSON that the model reads (`View.state` and the request's `state`), and the
  world plus the history (`State`). The JSON key is in every request, so a rename would change what the model reads.
- Changes to the trace other than the renames above, `informs` and `source`.

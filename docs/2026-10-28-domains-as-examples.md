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
renames the core's words to world, history, choice, menu and answer and removes two legal-judge fields, the second splits
the viewer so that chess gives its own part of the page, and the third moves each domain into `examples/<name>/` as a
package that imports `@osolmaz/switch` the way an outside project would. The first PR also takes the words of the
model's API where they fit: `state` means only the JSON that the model reads, `type` replaces `kind` on questions and
answers, and a pick keeps its `confidence`. Old traces, `result.json` and `run.json` files need some fields renamed
with the `jq` commands in this doc, and the commands move to each example's entry point.

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
| `State` and `state`       | `State<W>` in `src/core/types.ts`, and `View.state` and the request's `state`                             | One word for two things. The model's API calls the JSON that the model reads `state`, and `State<W>` is the world plus the log.          |
| `kind`                    | `kind` on every question and answer                                                                       | The model's API calls it `type`, and `kind` becomes the label of a choice.                                                               |

The model's API also returns a `confidence` with each pick, and switch drops it. The section on the model's words
below lists the words of both sides.

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

1. **Names in the core.** Rename the legal-judge words, call the log the history, use one word, choice, for a step
   that the model can take, call the domain's function that lists the choices `menu`, pass the world and the history
   as two arguments, use the model API's `type` for `kind`,
   keep the confidence of each pick, drop `informs`, make `source` optional, and fold `rejudge` into `run`. Small
   changes in many files, and no files move.
2. **Viewer split.** switch's viewer shows any domain, and chess gives its board, sounds, move list and PGN as its own
   part of the page.
3. **Domains as packages.** Each domain becomes a package in `examples/<name>/` with its code, data, tests and entry
   point, and switch becomes a package with `exports`.

The viewer split comes before the packages. After it, switch's viewer and its tests need no domain, so the third PR
moves folders and wires entry points, and changes no viewer code.

## Names in the core

### Terms

The menu function is the center of switch: it is how a domain presents its world and its history to the model as a
short list of choices. After the first PR, switch uses these words, and only these, in its code and its docs. The
README introduces them in this order, with the menu first.

| Term         | Meaning                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| world        | What one case gives, loaded once and fixed for the run: the task and its files, or the start position, the side and the opponent. |
| history      | The steps taken so far in the run, in order.                                                                                      |
| step         | One entry of the history: the kind and the key of the choice that ran, and its observation.                                       |
| menu         | The domain's function `menu(world, history)`, and the list of choices that it returns for the current step.                       |
| choice       | One thing that the model can do now, with the text that the model reads and the code that runs it. Stop is a choice too.          |
| kind         | The label of a choice, such as `read` or `move`.                                                                                  |
| observation  | What a choice found when it ran: a text for the model, and data for tools.                                                        |
| view         | The domain's function that turns the world and the history into the JSON that the model reads.                                    |
| state        | That JSON, as the model's API calls it.                                                                                           |
| instructions | The text that tells the model how to pick from the menu, or how to answer a question.                                             |
| question     | What the model answers at the end of the steps: a `bool`, a `choice` or a `score` question.                                       |
| answer       | The model's answer to a question, with its probabilities.                                                                         |

`AGENTS.md` gets a rule to use these terms and not their old names: workspace, log, entry, option and action, and
judge outside legal-judge, which keeps the word for its own judge files.

### World

`workspace` becomes `world` everywhere in the core. The world is what one case gives, loaded once and fixed for the
run. Everything that changes goes into the history, so the world and the history together say where a run is.

- The functions that need the progress of the run take the world and the history as two arguments, and the `State`
  type goes. The section on the two arguments below lists them.
- The code of a choice, `run(world, arg)` in the spec of its kind, whose comment says "A choice only reads the world."
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

`log` becomes `history`, and `Entry` becomes `Step`. The history is the list of steps taken so far in a run, in
order: the model's choices and what each one found. Each step records the kind of the choice, its key, and its
observation. The domain's `start` adds the opening steps, the core adds one step after each pick, and nothing else
changes the history.

- `RunResult.log` becomes `RunResult.history`, a list of `Step`.
- `Step` is a better name than `Entry`, which is close to `TraceEntry`, a different thing, and says nothing about
  what it holds.
- The domains' helpers take `history`, such as `movesOf(history)` in chess and `readParts(history)` in legal-judge.
- No file on disk has a `log` field, so this rename changes no file.

Names considered:

- `steps` already means the number of steps, in `RunResult.steps` and `Limits.steps`.
- `trajectory` is jargon, and it sounds like a finished run.

### Choice and menu

switch uses one word, choice, for a step that the model can take now: "Nc6 (knight b8 to c6)", "Read contract.pdf,
part 2", or stop. It is the word of the model's API: the menu goes to the model as a `choice` question, its choices
are the menu's choices, and the answer's `choice` is the one that the model took. The words "option" and "action"
leave the code and the docs. "Read", "search" and "move" become each choice's `kind`, a label that the trace and the
viewer can group by.

A domain gives one function, `menu`, that returns the choices for the current step:

```ts
interface Choice {
  /** A label such as "move" or "read". */
  readonly kind: string;
  /** Unique in a run, such as "move:0:e2e4"; a choice whose key is in the history is not offered again. */
  readonly key: string;
  /** What the model reads. */
  readonly text: string;
  /** Lower keeps the choice when the menu must be cut; 0 by default. */
  readonly priority: number;
  readonly data?: JsonObject;
  run(): Promise<Observation>;
}

interface Domain<W> {
  menu(world: W, history: readonly Step[]): readonly Choice[];
  // the rest stays as it is
}
```

The helper `choiceKind` keeps today's typed argument. It turns the spec of one kind into a function of the same shape
as `menu`, which returns that kind's part of the menu. A domain with more than one kind joins them in the order that it
wants on the menu:

```ts
// chess: one kind
const move = choiceKind<ChessGame, Play>({
  name: "move",
  menu(game, history) {
    const before = movesOf(history);
    const board = replay(game.start, before);
    if (statusOf(board) !== "playing") return [];
    return board.moves({ verbose: true }).map((legal) => ({
      key: `${String(before.length)}:${legal.lan}`,
      text: describe(legal),
      arg: { before, lan: legal.lan },
    }));
  },
  run: play,
});
// in the domain: menu: move

// legal-judge: six kinds, in menu order
// in the domain: menu: (world, history) => [read, look, search, count, changes, compare].flatMap((kind) => kind(world, history))
```

What changes:

- `MenuItem` and `Option<A>` become `Choice`. Today's `Action<W>`, the code that lists one kind, becomes the function
  that `choiceKind` returns. `action()` becomes `choiceKind()`, and its spec's `options` and `observe` become `menu`
  and `run`.
- `Domain.actions`, a list, becomes `Domain.menu`, a function. The core keeps doing what `buildMenu` does today with
  the choices that `menu` returns: it removes the choices whose key is in the history, refuses two choices with the
  same key or text, cuts the list to the limit by priority, and adds stop.
- `Entry.action` becomes `Step.kind`. Stop is a choice with the kind and the key `stop`.
- `Domain.choose` becomes `Domain.instructions`: the text that tells the model how to pick from the menu. It is a
  text that reads like a function today, beside the core's function `choose()`, and the model's API calls it the
  `instructions` of the menu's choice question. The chess definition records it as `instructions`, which also
  changes its hash.
- `Limits.options` becomes `Limits.choices`: the most choices on one menu, stop included.
- The `Ending` value `"no options"` becomes `"empty menu"`, so that no one mistakes it for `"no choice"`, which means
  that the model's pick failed. No file records `ended`.
- The trace's menu entries list `choices` in place of `options`, each with `kind` in place of `action`. Observation
  entries have `kind` in place of `action`. The `case` entry and `run.json` have `limits.choices` in place of
  `limits.options`.
- The legal-judge files in `judges/` and the chess definition have `limits.choices`, so both definition hashes change,
  and so does the legal-judge version, which includes the judge's hash. The menus and the requests to the model do not
  change.
- legal-judge's folder `actions/` becomes `choices/`. In the viewer, `FrameOption`, `optionList`, `ChessOption` and
  `chessOption` become `FrameChoice`, `choiceList`, `ChessChoice` and `chessChoice`. The READMEs say "choice" for
  "option".
- Settings objects keep their names, such as `RunOptions`, `AskOptions` and `CaseOptions`. There "options" means
  settings, as in most TypeScript code, and not the choices on a menu.

Names considered:

- "Action" is the word of reinforcement learning, and "option" is the word of a menu. The model's API says "choice",
  and one word on both sides of a request is clearer.
- For the function: `choices` reads like a field that holds a list, and the choice question already has a `choices`
  field. `availableChoices` is two words. `enabled`, the state-machine word for the transitions that are possible in a
  state, is rare, and it can read like a yes/no test. `menu` is switch's own word: the model picks from a menu, and
  the trace records each step's menu.

### World and history as arguments

The `State<W>` type goes. Each function that needs the progress of the run takes the world and the history as two
arguments:

- `Domain.menu(world, history)`, and the `menu(world, history)` of each kind's spec.
- `Domain.view(world, history, purpose, tokens)`.
- `AnswerContext` has `world` and `history` in place of `state`.
- In the core: `buildMenu(domain.menu, world, history, room)`, `takeSteps`, `choose`, `ask` and the asker that the
  answer hook gets.

After this, "state" has one meaning in switch, the one that it has in the model's API: the JSON that the model reads.
The domain's `view` returns it as `View.state`, and each request carries it as `state`. No file and no request
changes.

### Type for question and answer kinds

`kind` becomes `type` on every question and every answer, as in the model's API: `{ type: "bool", id, instructions,
yes, no }`, or `{ type: "choice", choice, probabilities }`. After this, `kind` is only the label of a choice.

- The answers in `result.json`, in the trace's `answers` and `asked` entries, and in `requests.jsonl` have `type`.
- The requests to the model do not change, because the adapter in `src/models/pi-ai.ts` already sends `type`. It no
  longer renames the field, and it still maps switch's `choices`, `levels`, `yes` and `no` to the API's `criteria`.
- `requests.jsonl` files from before keep `kind`. Only the run totals read these files, and they read only the usage,
  so the old files need no change.
- The legal-judge scoring, the viewer's answer text and the fake decider in the tests read `type`.

switch keeps its own names where they say more than the API's names. `choices`, `levels`, and `yes` and `no` stay,
because the API's one word `criteria` has three shapes: a map, a list, and a pair of `true` and `false`. `Decider` and
`decide` stay, because in switch the model decides the next step, and OpenAI calls the same kind of API "Decisions".
`bool` stays, because it is pi-ai's public word, and `noul` is only TypeSafe's wire format.

### Confidence of a pick

The model's API gives a `confidence` with each choice answer, next to the probabilities. Today `fromAnswer` in
`src/models/pi-ai.ts` drops it. `ChoiceAnswer` gets an optional `confidence`, and the trace's `choice` entry, which
records each step's pick, gets the same optional field. `result.json` keeps it for the choice questions of a domain.
It is optional because the traces and result files from before do not have it, and because a decider other than
pi-ai's need not give one. The requests to the model do not change.

### Words on the model's side

The core sends the menu to the model as one question. With Jev, TypeSafe's classifier model and
switch's default, the request goes through pi-ai's classifier API. pi-ai sends each question to TypeSafe's
`/systemone` endpoint as it is, except that it renames `bool` to `noul` (`dist/api/system-one-shared.js` in pi-ai
1.4.0). These are the words on each side; TypeSafe's own documentation was not checked.

| switch today                                                                      | pi-ai and TypeSafe                                       | switch after the first PR                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `state`: the JSON that the model reads (`View.state`), and also `State<W>`        | `state`: the JSON that the model reads                   | `state`: only the JSON that the model reads            |
| `kind: "bool" \| "choice" \| "score"` on questions and answers                    | `type`                                                   | `type`                                                 |
| each option on the menu, as a label `o1`…`oN` or `stop`, with the option's `text` | a key of the choice question's `criteria`, with its text | each choice on the menu, as today                      |
| `choices`, `levels`, and `yes` and `no`                                           | `criteria` for each of the three question types          | the same as today                                      |
| `bool`                                                                            | `bool` in pi-ai, and `noul` on TypeSafe's wire           | `bool`                                                 |
| the model's pick: `choice` and `probabilities`                                    | `choice`, `probabilities` and `confidence`               | `choice`, `probabilities` and an optional `confidence` |
| `Decider` and `decide`                                                            | a classifier model and `classify`                        | the same as today                                      |

After the first PR, switch and the model's API use "choice" in the same way. The domain's menu lists the choices,
they are the choices of the choice question, and the answer's `choice` is the one that the model took. On the
model's side a choice is only a label with a text. `choose` in `src/core/loop.ts` turns each choice on the menu into
a label, and the label that the model took back into its choice, which the core then runs.

### Answer

`Domain.judge?` becomes `Domain.answer?`, and `JudgeContext` becomes `AnswerContext`. Without the hook, the core asks
the questions once over the view. With it, the domain asks them in stages of its own. legal-judge keeps its function
`judgeWith(definition)`, because in legal-judge it is a judge. The comment on `AskError` says "an answer stage", and
the trace's `asked` entries keep their stage names.

### Steps

The word "evidence" leaves the core. `gather` becomes `takeSteps`, `Domain.stop` is "the text of the stop choice", and
the comments on `AskOptions` say "the view" for "the evidence view". This changes comments and one function name, and
no behavior.

### Informs into data

`Option.informs` and `MenuItem.informs` go, and so does `informs` on the trace's menu entries. legal-judge's `search`
puts the rubric items of a term into the choice's data: `data: { informs: term.items }`. PR #24 added `data` for facts
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
  each observation's source, and the chess view never showed it. The menus have the same choices in the same order.
- The chess version stays the same. The questions and answers keep their fields, with `type` for `kind` and an
  optional `confidence` on a pick.
- The trace keeps its entry types and the keys of every step. Only the field names above change, and the migration
  section gives the `jq` commands that rename them in an old trace, `result.json` and `run.json`. The readers do not
  accept the old names.

What changes besides the names: both definition hashes and the legal-judge version, because `limits.options` is
renamed to `limits.choices` in both definitions.

### Tests

- The existing tests, with the new names.
- A domain's `menu` is the menu's only source: the core keeps its order, removes the choices already taken, cuts by
  priority, and adds stop. An empty menu ends the steps with `"empty menu"`.
- The trace's menu entries list `choices` with a `kind`, observation entries have a `kind`, and `limits` has
  `choices`.
- A legal-judge search choice carries `informs` in its `data`, and the trace's menu entries have no `informs` field.
- An observation without a source is written without one, and a replay of it passes.
- `menu`, `view` and the answer hook get the world and the history as two arguments.
- Questions and answers have `type`, in the requests that the fake decider records, in the trace and in
  `result.json`.
- The pi-ai adapter keeps the `confidence` of a choice answer, and the trace's `choice` entry and `result.json` keep
  it.
- A trace and a `result.json` that the migration's `jq` commands renamed load in the viewer, replay, and `score`.
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
  choice's probability, "What happened", the notes, the confidence chart, and the result panel with the outcome and
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
│       ├── src/          the domain, its setup, choices/, ingest/, score/, main.ts
│       ├── judges/       the 2 files that are in judges/ today
│       └── tests/
└── docs/
```

`judges/`, `src/domains/` and `src/eval/` go, and `assets/` keeps only the README's cover. `examples/` holds only
packages.

### switch as a package

`pnpm-workspace.yaml` gets `packages: ["examples/*"]`. Each example depends on `"@osolmaz/switch": "workspace:*"`
and imports switch only through that package name.

switch's `package.json` gets `exports`:

| Import                    | What it gives                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@osolmaz/switch`         | the core: the types, `choiceKind`, `run`, the trace, replay, `Setup`, `runnerOf` and `definitionOf`    |
| `@osolmaz/switch/models`  | `piAiDecider`                                                                                          |
| `@osolmaz/switch/cli`     | `commandLine`, and the readers of run folders and eval sets: `readRunRecord`, `readResults`, `loadSet` |
| `@osolmaz/switch/viewer`  | `DomainViewer`, the server side of a domain's part of the page                                         |
| `@osolmaz/switch/page`    | the page's types and helpers for the browser side of a domain's part, and `registerPart`               |
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

- `src/domains/`, `src/eval/`, and in `src/cli/domains.ts` `INGESTERS` and the list of domains. The file keeps the
  type of a harness's domains, which `commandLine` takes, and `DomainError`.
- `Setup.categories`, `CaseRun.categories`, and `categories` in `result.json`.
- `labels` in the eval set. switch's set file holds `name`, `cases` and `ids`, and its schema allows more fields, so
  that a harness can add its own. legal-judge's scoring reads `labels` from the same file, so today's set files work
  for both without a change.
- `packageRoot` leaves the core. Only `src/cli/source.ts` still uses it, to find switch's own `package.json` and Git
  commit, so it moves to `src/cli`.
- The `bin`, and `judges` and `assets` in `files`.
- The dependencies that moved to the examples.

### Checks

`pnpm check` checks switch and both examples, and CI runs the same checks.

Slophammer treats a folder with a `package.json` and TypeScript sources as a project of its own, and requires each
project to have its own checks. So each example has them, as a project outside switch would:

- Its own `tsconfig.json`, which extends switch's and so keeps strict mode and the `switch-source` condition.
- Its own `eslint.config.mjs` with switch's rules, and a `no-restricted-imports` rule that refuses an import by path
  out of the example's folder. The examples reach switch only through `@osolmaz/switch`.
- Its own `vitest.config.ts`, which resolves the condition and holds the 85% coverage gate on `src/**`, without the
  entry point.
- Its own `format`, `lint`, `typecheck`, `test`, `coverage`, `dry` and `check` scripts. CI runs them in a step whose
  working directory is the example, which is where Slophammer looks for them.

switch's own configs leave `examples/` out, and its `pnpm check` runs each example's `check`. In `slophammer.yml`,
each example may import only its own folder, and switch's rules lose the domain entries. The DRY scan also covers
`examples`, without the two config files that each example keeps a copy of. CI still installs `poppler-utils` and
`netpbm`, which the legal-judge ingest tests use.

### Docs

- The README describes switch, links each example, and shows an entry point in "Write a domain".
- Each example's README moves with it and gets the new commands.
- `AGENTS.md` gets the boundaries for `src/` and `examples/`, the words world, history, choice and menu, and the
  `switch-source` condition.
- `docs/2026-10-25-switch-plan.md` links this doc.
- Dated docs stay as they are, because they describe the repository on their date.

## Migrations and breaking changes

Each change replaces the old contract in place. No old name, command or reader stays.

| Before                                     | After the PR    | What to do                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trace                                    | names           | Rename its fields with the first `jq` command below. The viewer, `replay` and `run --steps-from` read traces.                                                                                                                                                                                                                                                                                       |
| A `result.json`                            | names           | Rename `kind` to `type` in its answers with the second `jq` command below. The viewer, `score` and `compare` read it.                                                                                                                                                                                                                                                                               |
| A `run.json`                               | names           | Rename its fields with the third `jq` command below. A `run.json` from before PR #24 also needs `judge` renamed to `definition`, and its inner `definition` to `content`. Only run continuation and `compare` read it.                                                                                                                                                                              |
| A `requests.jsonl`                         | any             | Nothing. Only the run totals read it, and they read only the usage.                                                                                                                                                                                                                                                                                                                                 |
| A definition file of your own              | names           | Rename `limits.options` to `limits.choices`. Its hash changes.                                                                                                                                                                                                                                                                                                                                      |
| `switch rejudge --from <run> …`            | names           | `run --steps-from <run> …`                                                                                                                                                                                                                                                                                                                                                                          |
| `switch run --domain chess …`              | packages        | `examples/chess/src/main.ts run …`                                                                                                                                                                                                                                                                                                                                                                  |
| `switch run …` for legal-judge             | packages        | `examples/legal-judge/src/main.ts run …`                                                                                                                                                                                                                                                                                                                                                            |
| `switch ingest`, `score` or `compare`      | packages        | The same command on `examples/legal-judge/src/main.ts`.                                                                                                                                                                                                                                                                                                                                             |
| `switch view <run>`                        | packages        | `view <run>` on the entry point of the example that made the run.                                                                                                                                                                                                                                                                                                                                   |
| `switch replay …`                          | packages        | `replay …` on that entry point.                                                                                                                                                                                                                                                                                                                                                                     |
| An eval set file                           | packages        | Nothing.                                                                                                                                                                                                                                                                                                                                                                                            |
| A path into `judges/` or `examples/chess/` | packages        | `examples/legal-judge/judges/` and `examples/chess/cases/`.                                                                                                                                                                                                                                                                                                                                         |
| A domain written outside this repository   | names, packages | Rename `workspace` to `world`, `log` to `history` and `judge` to `answer`. Turn the list of actions into one `menu(world, history)` function with `choiceKind`, whose spec has `menu` and `run`. Take the world and the history as two arguments in `view`. Use `type` on questions and answers. Move `informs` into `data`, import `@osolmaz/switch`, and write an entry point with `commandLine`. |

The three `jq` commands rename the fields of one case's trace, one case's `result.json`, and a run's `run.json`. They
write new files, and you replace the old files after a check. The trace command drops `informs`, which nothing reads.
The commands were tried on a copy of a chess run, where the trace kept all 22 entries and no `options` or `action`
field was left, and on a small trace and result with answers of each kind.

```bash
jq -c '
  if .type == "case" then .limits |= (.choices = .options | del(.options))
  elif .type == "menu" then .choices = [.options[] | {key, kind: .action, text} + (if .data == null then {} else {data} end)] | del(.options)
  elif .type == "observation" then .kind = .action | del(.action)
  elif .type == "answers" or .type == "asked" then .answers |= map_values(.type = .kind | del(.kind))
  else . end' trace.jsonl > trace.renamed.jsonl

jq '.answers |= (if . == null then . else map_values(.type = .kind | del(.kind)) end)' result.json > result.renamed.json

jq '.limits |= (.choices = .options | del(.options)) | .stepsFrom = .evidenceFrom | del(.evidenceFrom)' run.json > run.renamed.json
```

## Out of scope

- Publishing switch to npm. The package stays private, and a Git install gets the build.
- A scorer for every domain. switch gets one when a second domain needs labels.
- A repository for each example.
- Changes to the trace other than the renames above, `informs`, `source` and `confidence`.
- Renaming switch's `choices`, `levels`, `yes`, `no`, `Decider` and `decide` to the API's words. The section on the
  model's words gives the reasons.

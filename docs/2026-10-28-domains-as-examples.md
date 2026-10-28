---
title: Domains as examples, and a run as a state machine
author: Onur Solmaz
date: 2026-10-28
---

# Domains as examples, and a run as a state machine

## TL;DR

A run of switch becomes one state machine: from an initial state S₀, the choice function gives the choices in the
latest state, the model picks one, and the transition function gives the next state. These three are the whole
interface that a domain must give, and behind them a domain may use any machinery of its own, such as chess.js and
Stockfish in chess. switch knows nothing about any domain, so the trace holds only the states, the choices, the picks
and the answers, and a replay reads the saved states and runs no transition again. This is the fourth and last PR of
this plan, [#29](https://github.com/osolmaz/switch/pull/29); old traces need the `jq` command that it adds, and
`run --steps-from` becomes `run --state-from`.

## Done

The first three PRs of this plan are merged:

- [#26](https://github.com/osolmaz/switch/pull/26) gave the core one word, choice, for what the model can pick. It
  took the model API's `type` for questions and answers, kept the `confidence` of each pick, and folded `rejudge` into
  `run --steps-from`.
- [#27](https://github.com/osolmaz/switch/pull/27) made the viewer show the run of any domain. Chess gives its board,
  sounds, move list and PGN as its own part of the page.
- [#28](https://github.com/osolmaz/switch/pull/28) moved legal-judge and chess into `examples/`. Each one is a package
  that imports `@osolmaz/switch` as an outside project would, with its own entry point that calls `commandLine`.

## Problem

Today a run has two parts. The world is what a case gives, and it stays fixed. The history is the list of steps
taken, and it grows. The domain's `menu(world, history)` gives the choices, and each choice has its own `run` code,
which finds an observation that becomes the next step.

That is two concepts for one idea: where a case is now. It also does not match the usual math of a state machine,
which has one state, an initial state, a function that gives the choices in a state, and a function that gives the
next state. This PR makes the code and the docs follow that math.

switch also still knows things about its two examples, which it must not:

- The trace's first entry, `case`, names the case. The trace does not need it: S₀ says where the run starts, and the
  folder that holds the trace names the case.
- The trace's `asked` entries carry legal-judge's answer stages. A domain without stages, such as chess, still gets
  an `asked` entry named "answers", with the same answers as the `answers` entry after it.
- `src/view/page.ts` holds the chess styles: the board, the squares, the pieces, the arrows, the check mark, the
  player bars, the move list and the board colors. The stage size is named `--board`.
- Comments and help texts in `src/` name legal-judge, its judge files, its rubric items and its labels, and the chess
  pieces and PGN: in `src/core/types.ts`, `src/cli/program.ts`, `src/cli/sets.ts`, `src/cli/root.ts` and
  `src/view/web/app.ts`.

## Rule

switch knows nothing about any domain. `src/`, the trace and the page have no domain's words, fields, file formats,
styles or special cases, also in the comments, help texts and examples in `src/`. A domain brings what it needs
through switch's general parts: its state, its choice function, its transition function, its view, its questions, its
own hooks, and its part of the page with its own styles. A concept goes into switch only when it means the same thing
for any domain.

`AGENTS.md` has this rule. A test makes it hold: it reads every file in `src/` and fails on the words chess,
legal, judge, rubric, Stockfish and PGN.

## Formulation

A case is a state machine. A run goes:

```text
S0 = initial()
for t = 1, 2, …
  C  = choices(St-1)                       the choice function
  ct = the model's pick from C and stop    the model reads view(St-1)
  if ct is stop: end
  St = transition(St-1, ct)                the transition function
then the model answers the questions over the last state
```

- The **state** Sₜ is everything that the functions need to know about where the case is after t steps. The domain
  gives its type. It is JSON, so that the trace can save it.
- The **initial state** S₀ is the state before the first pick. `initial()` makes it. In chess it holds the opponent's
  first move when the opponent moves first. In legal-judge it holds the parts of the answer that the model reads before
  the first pick.
- The **choice function** `choices(state)` takes the latest state and gives the choices in it. It does no work.
- The **model's pick** is the choice that the model takes from the choices and stop, with a probability for each one.
- The **transition function** `transition(state, choice)` takes the latest state and the picked choice and gives the
  next state. It does the work of the choice, such as reading a part of a file or getting the engine's reply.
- A **step** is one pass of the loop: the choices, the pick and the transition. `Limits.steps` counts them.

The data of a case that never changes has no name of its own. A legal case's files, or a chess game's start position,
seed and engine, stay inside the functions: for each case folder, the domain's `load` makes the functions with that
data in them. The chess board is never stored. The functions work it out from the start position and the moves in the
state.

## Interface

switch fixes one interface. Every domain must give three functions:

- the initial state, `initial()`;
- the choice function, `choices(state)`;
- the transition function, `transition(state, choice)`.

A domain may also give these, and switch has a default for each one:

- The view, `view(state, purpose, tokens)`. Without it, the model reads the state as it is, with no images, and
  switch does not cut it to fit the window.
- The questions, `questions()`, and the answer stages, `answer(context)`. Without questions, the run ends at the last
  state and asks nothing. Without answer stages, switch asks the questions once over the view.
- The outcome, `outcome(state, result)`. Without it, `result.json` has no outcome.

Behind the interface, a domain is free. It may use any library, program, data format or model of its problem, and
switch never sees them. Chess uses chess.js to work out the board from the moves and to list the legal moves, and
Stockfish for the opponent's reply. legal-judge uses its own ingest of PDF, Word, spreadsheet and email files, its
search terms and its page images. Each one builds its functions on its own machinery.

The interface is what connects the parts. It gives every domain the same structure, so switch runs any domain with
the same loop, trace, replay and viewer. It is also the one connection between a domain and the decision model: the
model reads the view of a state and picks one of the choices, and switch gives that pick to the transition.

## Types

```ts
/** One thing that the model can do in a state. Stop is a choice too, which switch adds with the type and key "stop". */
interface Choice {
  /** What sort of choice it is, for the trace and the viewer. */
  readonly type: string;
  /** Unique in a run. */
  readonly key: string;
  /** What the model reads. */
  readonly text: string;
  /** Lower keeps the choice when the choices must be cut; 0 by default. */
  readonly priority: number;
  /** Facts about the choice for tools that read the trace; the model never sees them. */
  readonly data?: JsonObject;
}

/** One case as a state machine: the interface. The case's fixed data is inside the functions. */
interface StateMachine<S extends JsonObject, C extends Choice = Choice> {
  initial(): Promise<S>;
  choices(state: S): readonly C[];
  transition(state: S, choice: C): Promise<S>;
  /** What the model reads in a state, in at most `tokens` estimated tokens; the state as it is by default. */
  view?(state: S, purpose: "choose" | "answer", tokens: number): Promise<View>;
  /** The questions at the end; none by default. */
  questions?(): readonly Question[];
  /** Answers the questions in stages of its own; without it, the questions are asked once over the view. */
  answer?(context: AnswerContext<S>): Promise<Readonly<Record<string, Answer>>>;
}

/** A domain, as a harness runs it on case folders: the texts and limits it shares, and the state machine of a folder. */
interface Domain<S extends JsonObject, C extends Choice = Choice> {
  /** The name and the version go into the trace and `run.json`. */
  readonly name: string;
  readonly version: string;
  /** The text of the stop choice, which ends the steps. */
  readonly stop: string;
  /** The text that tells the model how to pick from the choices. */
  readonly instructions: string;
  readonly definition: Definition;
  readonly limits: Limits;
  caseId(folder: string): Promise<string>;
  load(folder: string): Promise<StateMachine<S, C>>;
  /** How the case ended in the domain's own terms, from its last state. */
  outcome?(state: S, result: RunResult<S>): JsonObject;
}
```

- `StateMachine` is the interface of the section above. `Domain` adds what a harness needs to run cases from folders
  and record them: the name, the version, the two texts of the pick question, the definition, the limits, `caseId`
  and `load`.
- Today's `Domain` and `Setup` become one type, `Domain`. The four texts that every case shares had a type of their
  own, and only the setup used it.
- `runnerOf(domain)` gives the domain without its state type, so that a harness can keep domains of different state
  types together. Each example's `setup.ts` still gives the function that makes its domain from a definition file.
- The transition gets back the domain's own choice type `C`, so that it can read what the choice function put in the
  choice, such as a move.
- The view is async, because legal-judge's view reads the images that the state names.

## Choice types

A domain with several types of choice, such as legal-judge, can give each type in a file of its own. The helper
`choiceType` takes a type's part of the choice function and its part of the transition, with a typed argument.
`joinTypes` joins the types into one choice function and one transition function. The transition passes each choice
to the part of its type.

```ts
// Each type is made for one case, so it holds that case's files.
const search = (legalCase: LegalCase, terms: readonly Term[]) =>
  choiceType<LegalState, Term>({
    type: "search",
    choices: (state) =>
      terms
        .filter((term) => !found(state, `search:${keyOf(term)}`))
        .map((term) => ({ key: keyOf(term), text: choiceText(term), arg: term, priority: 1 })),
    transition: (state, term) => ({
      evidence: [
        ...state.evidence,
        {
          key: `search:${keyOf(term)}`,
          source: `search for “${term.term}”`,
          text: searchFiles(legalCase.files, term.term),
        },
      ],
    }),
  });

const { choices, transition } = joinTypes(read(legalCase), look(legalCase, folder), search(legalCase, terms) /* … */);
```

A domain with one type of choice, such as chess, can write the two functions without the helpers.

## What switch does to the choices

Before the model sees the choices, switch:

1. Refuses two choices with the same key or the same text.
2. Refuses a choice whose key the model already picked in this run. The state says what is done, so the choice
   function must leave it out. The check catches a bug in a domain.
3. Keeps at most `Limits.choices - 1` choices: the ones with the lowest priority value, in the domain's order.
4. Adds stop.

`offerChoices` in `src/core/choices.ts` does this, and it throws a `ChoiceError`.

## Trace

The trace saves every state. Its entries:

| Entry     | What it holds                                                                               |
| --------- | ------------------------------------------------------------------------------------------- |
| `start`   | the domain, its version, the model and the limits                                           |
| `state`   | `step` and the whole `state`; step 0 holds S₀, and one follows each transition              |
| `choices` | `step` and the choices that the model saw, stop included: key, type, text, data             |
| `pick`    | `step`, the picked key, the probabilities by key, the confidence and the usage              |
| `stage`   | the name and the answers of one stage of a domain's own `answer`; only such a domain has it |
| `answers` | the final answer to each question                                                           |
| `note`    | a message, such as what the view left out                                                   |

The trace names no case. The viewer and `replay` take the case's name from the folder that holds the trace, as the
run's layout gives it: `cases/<case>/trace.jsonl`.

A whole state in each entry keeps the trace simple. For the two examples, a trace stays below about 1.5 MB for one
case: a chess game has at most 201 states of a few KB, and a legal-judge case at most 9 states of at most about 120
KB of evidence.

legal-judge's look choice and its initial state add images. A state names each image by its file in the case folder,
with the label, the path and the media type that the case's `renders` hold. The view reads the files. So a trace
holds no image data, and no image is copied.

## Replay

The trace has every state, so a replay runs no transition and calls no model:

- `replay` reads S₀ to Sₜ from the trace. At each step it makes the choices from the recorded state, checks that the
  recorded pick is on them, and repeats it. Then it repeats the recorded answers. This checks that the domain's code
  still offers the recorded choices, and it writes a new trace.
- `replay --fork n` takes Sₙ from the trace. From step n + 1 the model picks and the transitions run.
- `run --state-from <run>` takes each case's last state from that run, and the model answers the questions again.
  `run.json` records `stateFrom`, and `compare` prints "state of <run>".

## Names that change

| Today                                                     | After this PR                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| the world, and the type parameter `W`                     | the case's fixed data, inside the functions; `S` for the state |
| the history, `Step` and `Observation`                     | the state                                                      |
| `kind` on a choice, `choiceKind` and `joinMenus`          | `type`, `choiceType` and `joinTypes`                           |
| `Domain.start(world)`                                     | `initial()`                                                    |
| `Domain.menu(world, history)` and `Menu<W>`               | `choices(state)`                                               |
| a choice's `run()`                                        | `transition(state, choice)`                                    |
| `Domain.view(world, history, purpose, tokens)`            | `view(state, purpose, tokens)`, async                          |
| `Domain.questions(world)`                                 | `questions()`                                                  |
| `AnswerContext.world` and `AnswerContext.history`         | `AnswerContext.state`                                          |
| `Setup`, and `Setup.load` that gives the world            | `Domain`, and `Domain.load` that gives a `StateMachine`        |
| `Setup.outcome(world, result)`                            | `Domain.outcome(state, result)`                                |
| `RunResult.history`                                       | `RunResult.state`, the last state                              |
| `View.state`, `DecisionRequest.state`, `AskOptions.state` | `View.json`, `DecisionRequest.json`, `AskOptions.json`         |
| `buildMenu` and `MenuError`                               | `offerChoices` and `ChoiceError`                               |
| the `Ending` values `"empty menu"` and `"no choice"`      | `"no choices"` and `"pick failed"`                             |
| the trace entries `observation`, `menu` and `choice`      | `state`, `choices` and `pick`                                  |
| the trace entry `case`, and `RunOptions.case`             | the trace entry `start`, with no case                          |
| `asked` entries, for any domain                           | `stage` entries, only for a domain with its own `answer`       |
| the chess styles in `src/view/page.ts`                    | the chess part's stylesheet                                    |
| the stage size `--board` in the page's styles             | `--stage`                                                      |
| `run --steps-from`, and `stepsFrom` in `run.json`         | `run --state-from`, and `stateFrom`                            |

After this PR, "state" has one meaning in switch: Sₜ. The model's API calls the JSON that the model reads `state`.
Only the adapter in `src/models/pi-ai.ts` uses that word, where it sends the request's `json` as the API's `state`.
`requests.jsonl` records `json`.

## Terms

switch uses these words, and only these, in its code and its docs. The README's "How it works" introduces them in
this order.

| Term                | Meaning                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| state               | Where a case is after some steps: everything that the functions need, as JSON. Sₜ after t steps.         |
| initial state       | S₀, the state before the first pick, which `initial()` makes.                                            |
| choice function     | `choices(state)`: takes the latest state and gives the choices in it.                                    |
| choice              | One thing that the model can do in a state, with the text that the model reads. Stop is a choice too.    |
| pick                | The choice that the model takes, with a probability for each choice.                                     |
| transition function | `transition(state, choice)`: takes the latest state and the picked choice and gives the next state.      |
| step                | One pass of the loop: the choices, the pick and the transition.                                          |
| view                | `view(state, purpose, tokens)`: the JSON and the images that the model reads in a state.                 |
| instructions        | The text that tells the model how to pick from the choices, or how to answer a question.                 |
| question            | What the model answers at the end of the steps: a `bool`, a `choice` or a `score` question.              |
| answer              | The model's answer to a question, with its probabilities.                                                |
| trace               | The record of a run: every state, the choices and the pick of each step, and the answers.                |
| type                | What sort of thing a record is: a choice such as `read` or `move`, a question, an answer, a trace entry. |

`AGENTS.md` lists these terms. Its rule against old names lists world, history, observation, menu, kind, workspace,
log, entry for a step, option and action.

## Chess

The chess state:

```ts
interface ChessState {
  /** The side that the model plays, or both in self-play. */
  readonly you: "white" | "black" | "both";
  /** The opponent's name, for the viewer. */
  readonly opponent: string;
  /** The position the game started from, in FEN. */
  readonly start: string;
  /** Every move so far, of both sides: in long algebraic notation, and in SAN. */
  readonly moves: readonly string[];
  readonly san: readonly string[];
  readonly fen: string;
  readonly status: Status;
  readonly check: boolean;
  /** What the last step did, such as "You played e4. The opponent played e5.". */
  readonly last: string;
}
```

- `you`, `opponent` and `start` never change. They are in the state because the viewer draws them: the players' bars,
  and the move numbers and the set-up position of the PGN. The seed, the move time and the engine stay inside the
  functions that `load` makes.
- `initial()` plays the opponent's first move when the opponent is to move.
- `choices` gives the legal moves of the board that the start position and `moves` make, so chess.js still sees a
  repeated position. The keys stay `move:<plies>:<lan>`.
- `transition` plays the model's move and, against an opponent, the reply.
- `view` builds the position for the model from the state. Its `last_step` is the state's `last`.
- `outcome` reads the last state. The stop choice counts as a resignation.
- The chess part of the viewer reads the states. `web/data.ts` checks a chess state, and the moves of a step are the
  new entries of `moves`.

## Legal-judge

The legal-judge state:

```ts
interface LegalState {
  /** What the run found, in order: the key of each choice, its source, its text, and the image that it looked at. */
  readonly evidence: readonly { key: string; source: string; text: string; image?: Render }[];
}
```

- The case, its search terms and its folder stay inside the functions that `load` makes.
- `initial()` reads the answer's files up to the answer budget, looks at its images, and adds its Word formatting, as
  evidence entries.
- `choices` joins the six types: read, look, search, count, changes and compare. Each type leaves out the keys that
  the evidence already holds.
- `transition` adds the evidence entry of the picked choice.
- `view` builds the state for the model from the evidence, and reads the images that the entries name.
- `judgeWith` asks the judge's questions over the state.

## Viewer

- The viewer reads a story of states: S₀, and for each step the choices with their probabilities, the pick and the
  state after it.
- Without a domain part, the page shows what each step changed: each top-level field of the state whose value
  changed, and, for a list that only grew, its new entries. For legal-judge that is the new evidence.
- A domain part's hooks get the states.
- The page shows the case's name from the folder that holds the trace.
- A `DomainViewer` names its part's stylesheets as `styles: readonly URL[]`, and the page adds them after its own.
  The chess styles move from `src/view/page.ts` into the chess part's stylesheet: the board, the squares, the pieces,
  the arrows, the check mark, the player bars, the move list and the board colors. switch's page keeps only the
  layout, the panels and the controls, and names the stage size `--stage`.

## Docs

- The README's "How it works" describes the state machine with the terms above. It says that the three functions are
  the whole interface that a domain must give, and that a domain builds them on any machinery of its own. "Write a
  harness" shows a small domain with its state, `initial`, `choices` and `transition`.
- The example READMEs describe each example's state, initial state, choice function and transition function.
- `AGENTS.md` gets the terms. It already has the rule. Its boundaries say that `load`, `initial()`, the transition
  and the view's image reads are the only parts of a run that read files or start programs, and that the choice
  function reads only the state and the case's fixed data.
- The comments and help texts in `src/` that name an example get general words.
- `docs/2026-10-28-the-math-behind-switch.md` becomes an abstract explainer. It starts with no domain at all: one
  state Sₜ, S₀, the choice function, the model's pick and the transition function, and then what switch does to the
  choices, one pick, a run, the replay and the window, with symbols only. It names no model, no file path and no flag.
  Where an example helps, it uses chess, and it uses no legal-judge example. Its two legal-judge sections, on verdicts
  and on scores, move to the legal-judge README.

## Tests

- A domain with only `initial`, `choices` and `transition` runs: the model reads its state as it is, and the run
  asks no questions.
- The core, with a test domain whose state is a small object: `initial` runs once, and `choices` and `transition`
  run once per step. The run saves each state, and ends at stop, with no choices, at the step limit, and when the
  pick fails.
- The choices: the run refuses two choices with one key or one text, and a key already picked. It cuts by priority
  and adds stop.
- The trace starts with a `start` entry that names no case, and has `state`, `choices` and `pick` entries. It has
  `stage` entries only when the domain has its own `answer`.
- The rule: no file in `src/` has the words chess, legal, judge, rubric, Stockfish or PGN.
- The page without a domain part has no chess styles, and the chess part's page has them.
- Replay: with a transition that throws, a replay still passes. A recorded pick that is not on the choices fails the
  replay. A fork from Sₙ runs the transitions after step n. `run --state-from` takes the last state and asks only the
  questions.
- Chess: the initial state when the opponent moves first, a move and its reply, the view from a state, the outcome
  from the last state, and the viewer's board from the states.
- Legal-judge: the initial state, each type leaving out what is done, a transition that adds one evidence entry, the
  view with the named images, and the judge over the state.
- A check before the merge: the requests that a test case of each domain sends to the model are byte for byte the
  same as on `main`.

## What stays the same

- The requests to the model, as the last test checks: the same views, the same choices in the same order, the same
  keys and the same images.
- The definitions and their hashes. The domain versions change, because the traces change.
- `result.json`, the commands other than `run --state-from`, the packages and their entry points.

## Migrations

This PR replaces the old contract in place. switch keeps no reader for the old trace entries.

| Before                   | What to do                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trace                  | Turn it into states with the example's `jq` command, which this PR adds to each example's README after a try on a copy of a run. The command also turns the `case` entry into a `start` entry without the case, renames `asked` to `stage`, and drops an `asked` entry named "answers". The legal-judge command also reads the case's `case.json`, to name the file of each image from the key of the look. |
| A `run.json`             | Rename `stepsFrom` to `stateFrom` with `jq '.stateFrom = .stepsFrom \| del(.stepsFrom)' run.json > run.renamed.json`.                                                                                                                                                                                                                                                                                       |
| A `result.json`          | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                    |
| A `requests.jsonl`       | Nothing. Only the run totals read it, and they read only the usage.                                                                                                                                                                                                                                                                                                                                         |
| `run --steps-from <run>` | `run --state-from <run>`                                                                                                                                                                                                                                                                                                                                                                                    |
| A domain of your own     | Merge its setup into one `Domain`, and give a JSON state type and a `load` that makes a `StateMachine` for each case folder. Move the code of each choice's `run` into the transition, and the world into the functions. Use `type` on choices and `json` on views.                                                                                                                                         |

A run from before #26 first needs the renames of #26. These commands write new files, and you replace the old files
after a check:

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

## Where the build differs from the plan

The fourth PR follows the plan above, with these differences and additions:

- **Chess state.** It also holds `start`, the start position, because the viewer numbers the moves and writes the
  PGN's set-up position from it.
- **Loop.** `run(texts, machine, decider, options)` takes the four texts that every case shares as `DomainTexts`, and
  the case's state machine. `RunOptions` has no `case`.
- **Choices.** `Choice.priority` is optional, 0 by default. `offerChoices` also refuses a choice with the key `stop`.
  `choiceType` gives a function from a state to its choices, each of which carries the transition of its type, and
  `joinTypes` joins such functions into one choice function and one transition function.
- **Errors.** `SetupError` becomes `DefinitionError`, because `Setup` goes and the error means a definition that the
  domain does not take.
- **Viewer.** The story has `initial` in place of `opening`. A frame and each of its choices have `picked` in place of
  `chosen`, and a moment has `type` and `state` in place of `kind` and `seen`. Without a domain part, the stage shows
  the state as JSON, and the side panel lists "What changed" with `changesOf`. The page's own classes `menu`,
  `chosen`, `history`, `player-slot` and `moves` become `choices`, `picked`, `timeline`, `bar-slot` and `steps`.
  `ViewerPage.styles` holds the parts' styles, which `partStyles` reads, and the page entry point exports the `Json`
  and `JsonObject` types for a part's state type.
- **Legal-judge.** `world.ts` becomes `state.ts`. A `CaseFolder`, the case and a way to load its images, replaces the
  world inside the functions, and `legalMachine(definition, folder)` makes a case's state machine. The initial state is
  made without reading a file. An answer with more images than the case may see now gets exactly that many: before,
  a negative slice dropped images from the end.
- **Chess.** `CHESS` holds the texts, `chessMachine(game)` makes a game's state machine, and `movesIn` and `play` are
  its choice function and the body of its transition.
- **Checks.** A test checked before the merge that the requests of a chess game and of a legal-judge case with
  images are byte for byte the same as on `main`. The `jq` commands were tried on copies of three earlier chess runs
  and on traces that `main` wrote for test cases; the converted traces equal the traces that the new code writes,
  except for the domain's version.

## Out of scope

- Saving only what changed between two states, in place of each whole state. A later PR can do it if traces grow too
  large.
- Publishing switch to npm, and a repository for each example.

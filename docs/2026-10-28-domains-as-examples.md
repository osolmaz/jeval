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
this plan, [#29](https://github.com/osolmaz/switch/pull/29); old runs are run again from scratch, and
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
through switch's general parts: its state, its choice function, its transition function, its view function, its questions, its
own hooks, and its part of the page with its own styles. A concept goes into switch only when it means the same thing
for any domain.

A follow-up after this plan made the rule stricter: switch holds only the interface between a domain and a decision
model, and the glue to the model. It has no user interface. The web viewer is a package of its own, with the same
rule.

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

- The view function, `view(state, purpose, tokens)`. Without it, the model reads the state as it is, with no images, and
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
- The view function is async, because legal-judge's view function reads the images that the state names.

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
| view function       | `view(state, purpose, tokens)`: takes a state and gives the view.                                        |
| view                | The JSON and the images that the model reads in a state.                                                 |
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
- `docs/2026-10-28-the-math-behind-switch.md`, now [`docs/MATH.md`](MATH.md), becomes an abstract explainer. It starts with no domain at all: one
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

This PR replaces the old contract in place. switch keeps no reader for old run folders, and nothing converts them:
cases that ran before it are run again from scratch.

| Before                   | What to do                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A run folder             | Run its cases again with the new code.                                                                                                                                                                                                                              |
| `run --steps-from <run>` | `run --state-from <run>`                                                                                                                                                                                                                                            |
| A domain of your own     | Merge its setup into one `Domain`, and give a JSON state type and a `load` that makes a `StateMachine` for each case folder. Move the code of each choice's `run` into the transition, and the world into the functions. Use `type` on choices and `json` on views. |

## Where the build differs from the plan

The fourth PR follows the plan above, with these differences and additions:

- **Chess state.** It also holds `start`, the start position, because the viewer numbers the moves and writes the
  PGN's set-up position from it.
- **Loop.** `run(shared, machine, decider, options)` takes what every case shares as `DomainShared`, the name, the
  version, the two texts of the pick question and the limits, and the case's state machine. `RunOptions` has no
  `case`, and its `limits` only override the domain's, as a replay does with its trace's. A follow-up PR removed
  `DEFAULT_LIMITS`, whose values were legal-judge's, and renamed `DomainTexts` to `DomainShared` when the limits joined
  it.
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
  images are byte for byte the same as on `main`.
- **Old runs.** The PR first gave each example a `jq` command that turned an old trace into states. After the merge,
  the owner chose to run old cases again from scratch, so a follow-up PR removed the commands.
- **Outcome.** The page no longer reads the outcome's `result` and `reason` fields, which came from chess. A
  `DomainViewer` may give `summary(outcome)`, a short line for the list of cases and the result's banner, and the
  session carries it as `summary`.
- **View function.** The docs name `view` the view function, beside the choice function and the transition function,
  and its result the view.
- **Look of the page.** A review after the merge found that switch's page still had chess.com's colors and a layout
  made for a square board between two player bars. switch's page now has neutral colors as CSS variables and a stage
  that takes the size of what it shows. The page marks the document with the case's domain, as
  `data-domain="chess"`, and the chess stylesheet sets chess.com's colors and the board's layout under that mark.
- **Word check.** `tests/no-domain.test.ts` also finds a word at the start of a part of a camelCase name, such as
  `chessPart`, and checks more words of both examples. The view tests check that switch's own styles have no square
  stage, no room for bars and none of chess.com's colors.
- **Viewer out of switch.** The owner then ruled that switch is an abstract framework: the interface and the model
  glue, and no web app. `src/view/` and the `view` command moved to a package of their own, `viewer/`
  (`@osolmaz/switch-viewer`), which imports switch by its package name as the examples do. `commandLine` gives `run`
  and `replay` only, and a harness adds the viewer's `viewCommand`; `run --view` went, since `view` follows a run
  while it runs. The entry points `@osolmaz/switch/viewer` and `@osolmaz/switch/page` became `@osolmaz/switch-viewer`
  and `@osolmaz/switch-viewer/page`, and `HarnessDomain` lost its `viewer`.
- **Part hooks.** The page's `sound`, `bars` and `score` hooks went, since only chess had a use for them. A part's
  `stage` gets the session, and draws all of the stage. Chess draws its players' bars and its sound button there,
  plays its own sounds when its board moves, and shows the score under its move list. The word check now also covers
  `viewer/src`, with the words sound and player, and a test checks that `src/` has no browser, HTML, style or HTTP
  server code.
- **Domain flags.** `run` and `replay` lost `--definition <file>`, which existed for legal-judge's judge files, and
  `DefinitionError` went with it. A `HarnessDomain` can declare `flags` of its own, which both commands take, and its
  `setup` gets their values by name. legal-judge declares `--judge <file>`; chess declares none, and its setup takes
  nothing. The `Definition` record in `run.json` stays.
- **Word lists.** Each example lists its words in `domain-words.txt`, and the word check reads every example's list
  in place of a list of its own, so a new example is covered once it brings its list.

## The decision request

Status: done in [#33](https://github.com/osolmaz/switch/pull/33), together with the discrepancies below.

**Rule.** Everything that goes to a decision model or comes back from one follows pi-ai's standard forms, as far as
switch can use them: the request, the questions, the answers, the result and the usage. switch reshapes only where it
must, and the plan says why at each place.

The view function gives exactly what the decision model reads, and switch adds only the questions. Nothing else
changes the request on its way to the model.

The request, its questions and its answers follow pi-ai's classifier interface, which
[DECISION_MODEL_API.md](DECISION_MODEL_API.md#pi-ais-classifier-interface) describes. pi-ai sends that one form to
each of the three decision model APIs: System One, OpenAI Decisions, and chat models used as classifiers. A request in
it therefore runs on every classifier model that pi-ai lists. System One can say more, such as a string state or a
score's probabilities, but no domain needs that today. A System One decider can come later if one does.

Each field that carries pi-ai's content takes the prefix `decision`: `decisionState`, `decisionImages` and
`decisionQuestions` in the request, and `decisionAnswers` and `decisionUsage` in the result. So "state" in switch still
means only Sₜ, and the names show which data is pi-ai's. The fields about the call itself keep pi-ai's names: `api`,
`provider`, `model`, `stopReason`, `errorMessage` and `timestamp`.

```ts
/** One request to the decision model, in the form of pi-ai's ClassifierContext. */
export interface DecisionRequest {
  /** pi-ai's `state`: what the model reads, as a JSON object. */
  readonly decisionState: JsonObject;
  /** pi-ai's `images`: the images that the model reads with it. */
  readonly decisionImages: readonly Image[];
  /** pi-ai's `questions`: the questions by id. */
  readonly decisionQuestions: Readonly<Record<string, Question>>;
}

/** What the view function gives: the decision request without its questions, which switch adds. */
export type View = Omit<DecisionRequest, "decisionQuestions">;

// In StateMachine, with the same arguments as now:
view?(state: S, purpose: "choose" | "answer", tokens: number): Promise<View>;
questions?(): Readonly<Record<string, Question>>;
```

The questions and the answers take pi-ai's shapes exactly:

```ts
export type Question =
  | {
      readonly type: "bool";
      readonly instructions: string;
      readonly criteria: { readonly true: string; readonly false: string };
    }
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] };

export type Answer =
  | { readonly type: "bool"; readonly probability: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | { readonly type: "score"; readonly score: number; readonly confidence: number };
```

The decider gives back pi-ai's `ClassifierResult` as it is, with two fields of switch's own:

```ts
/** The decision model's result, in the form of pi-ai's ClassifierResult. */
export interface DecisionResult {
  /** pi-ai's `answers`, by question id. Empty when `stopReason` is not "stop". */
  readonly decisionAnswers: Readonly<Record<string, Answer>>;
  /** pi-ai's `usage`; null when the API reports no token counts. */
  readonly decisionUsage: DecisionUsage | null;
  readonly api: string;
  readonly provider: string;
  /** The model that was asked. */
  readonly model: string;
  readonly stopReason: "stop" | "error" | "aborted";
  readonly errorMessage: string | null;
  readonly timestamp: number;
  /** switch's own: the error says that the request was larger than the model's window, so a smaller view may fit. */
  readonly tooLong: boolean;
  /** switch's own: how long the call took, which pi-ai does not report. */
  readonly milliseconds: number;
}

/** pi-ai's `Usage`: token counts, and their cost in US dollars at the model's catalog price. */
export interface DecisionUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
}
```

A request is made like this:

1. **Pick.** switch turns the offered choices and stop into one choice question. It calls
   `view(Sₜ₋₁, "choose", τ)` and sends the view with that question.
2. **Answers.** switch splits the domain's questions into batches. For each batch, it calls `view(S, "answer", τ)` and
   sends the view with the batch.
3. **Window.** When a result has `tooLong`, switch calls the view function again with a smaller τ, as it does now.
4. **Decider.** The pi-ai decider passes the request to pi-ai as it is: `decisionState` as `state`,
   `decisionQuestions` as `questions`, and each image as `{ type: "image", data, mimeType }`. It gives back pi-ai's
   result as it is, with `tooLong` and `milliseconds` added.
5. **Record.** `requests.jsonl` keeps each decision request as it was sent, with each image by its label, and its
   decision result.

What changes:

- **View.** `json` becomes `decisionState`, and `images` becomes `decisionImages`. `omitted` and the trace's note "the
  view left out" go: the requests file shows what the model read, and a domain that cuts something writes that into
  `decisionState` when the model should know.
- **Images.** `Image` keeps its label next to the media type and the base64 data, so that the requests file can name
  each image without its bytes. The decider leaves the label out.
- **Questions.** `criteria` replaces `yes` and `no`, `choices` and `levels`, with `true` and `false` for a yes-or-no
  question. A question's id becomes its key, in `questions()` and in `decisionQuestions`, in place of an `id` field.
- **Answers.** A choice answer always has its `confidence`, as pi-ai always gives it. The rest of the answers already
  have pi-ai's shapes.
- **Result.** `DecisionResult` takes pi-ai's form, as above. Today it is switch's own: `ok` in place of `stopReason`,
  `message` in place of `errorMessage`, and `failure: "window" | "provider"`, which switch guesses from the message. It
  also drops `api`, `provider`, `model` and `timestamp`. `tooLong` replaces `failure` and is the one guess that stays,
  because pi-ai has no field for it and switch needs it to retry with a smaller view.
- **Usage.** `DecisionUsage` is pi-ai's usage. Today switch keeps only `inputTokens`, under its own name, so a run
  records no output, cache or cost counts, although pi-ai computes the cost. The trace's `pick`, `stage` and
  `answers` entries record the decision usage and the milliseconds. `run.json`'s totals sum the decision usage,
  cost included, in place of `inputTokens` alone.
- **Requests file.** Each line of `requests.jsonl` holds the decision request and the decision result. Today it holds
  switch's own request and result shapes.
- **Pick.** The pick keeps its short labels, `o1`, `o2` and so on, and `stop`, because choice keys can be long, such
  as `move:12:e2e4`, and the labels keep the request small. switch maps the answer's labels back to the choices' keys,
  and this mapping is the one reshape of an answer that stays. The trace's `pick` entry takes the choice answer's
  field names: `choice` in place of `key`, `probabilities` by choice key, and `confidence`, which becomes required.
- **Answer stages.** `AskOptions.json` and `AskOptions.extra` go. A stage can give its own view function instead,
  which switch fits to the window like the domain's. legal-judge's check stage builds its view from the normal view
  and its own texts.
- **Domains.** legal-judge's questions per rubric item take the new shapes. Chess asks no questions.
- **Docs.** `docs/MATH.md` writes the view function as
  $V(S, p, \tau) \to (\text{decisionState}, \text{decisionImages})$, and the README, `AGENTS.md` and the terms above
  follow.

What stays: switch keeps pi-ai as a dependency, and calls it only from `src/models`. The core has its own copies of
these types, so that it imports nothing from pi-ai.

## Other discrepancies

Status: done in [#33](https://github.com/osolmaz/switch/pull/33), as "How the build did them" below says. A review of
the code and the docs found these besides the reshapes of pi-ai's forms above.

**What a run records.**

1. **Why a case ended.** `RunResult.ended` says why the steps ended: `stop`, `no choices`, `step limit` or
   `pick failed`. `result.json` does not keep it, so a run cannot tell a model that stopped from one that ran out of
   steps, unless the domain's outcome copies it, as chess does. To do: `result.json` records `ended`, as part of the
   decision request change.
2. **The view function in the math doc.** `docs/MATH.md` writes $V(S, \tau)$, without the purpose that the code
   passes. To do: $V(S, p, \tau)$, as part of the decision request change.

**One idea with two names.**

3. **A domain has four names.** `Domain` is the interface, `Runner` is a domain without its state type,
   `HarnessDomain` is a domain with its flags and its setup, and `Domains` is a harness's set of them. `domainOf`
   returns a `HarnessDomain`, and `domainNamed` returns a `Runner`. Open: a design choice for the owner.
4. **Exchange and requests.** The requests file, `requests.jsonl` and `CaseFiles.requests`, holds values of the type
   `Exchange`, which `recording` makes. To do: one name for both.

**Stale words.**

5. **`switch run`.** `src/cli/runs.ts` and legal-judge's `src/score/score.ts` say what "`switch run`" writes, but no
   program is called switch: each harness has its own `run`. To do: "a harness's `run`".
6. **Banned old words in the examples.** legal-judge's `src/definition.ts` says "the menu's instructions", and chess's
   `src/web/model.ts` and legal-judge's `src/choices/changes.ts` use `kind` for a piece's and a file's type. To do:
   the current words.
7. **AGENTS.md points to an old plan.** It says to read `docs/2026-10-25-switch-plan.md` before changing the design,
   and that plan still uses world, actions and `src/view.ts`. To do: point to the README's "How it works" and
   `docs/MATH.md`.

**Repeated values.**

8. **The definition repeats the shared texts.** A domain gives `stop`, `instructions` and `limits`, and then repeats
   them in `definitionOf(name, { stop, instructions, limits })`, as chess and the README's example do, so the two
   copies can drift apart. `runnerOf` could build this definition itself and take a domain's own definition only when
   it has one, as legal-judge has its judge file. Open: a design choice for the owner.

### From a second review

A second review, which did not see the list above, found items 1 and 4 to 8 and the reshapes of pi-ai's forms again,
and these besides. Each one was checked in the code, except item 34.

**Replay and `--state-from`.** These change what a run does.

9. **`--state-from` can make new picks or stop early.** It repeats as many picks as the source trace has, but with
   today's limits (`src/cli/commands.ts:68`), not the trace's, as `replayCase` takes them. With a higher step limit, or
   a source case whose pick failed, the model makes new picks and transitions run; with a lower one, the run stops
   before the recorded last state. The README, the help text and `RunCasesOptions` say that only the questions go to
   the model again. To do: take the trace's limits, and end where the recording ended.
10. **Replay finds a recorded pick by its text, not by its key** (`src/core/replay.ts:127-128`). A stop pick no longer
    replays when the definition changes the stop text, as `run --state-from … --judge` does, and a choice whose key
    changed but whose text did not still passes. `offerChoices` also lets a choice have the stop's text. To do: match
    by key, and refuse a choice with the stop's text.
11. **A replay of a case whose pick failed ends with stop** (`replay.ts:117`). When the recorded picks run out, the
    replay answers the next pick with stop at probability 1; in chess, that becomes a resignation. To do: end with the
    recorded ending.
12. **A replay of a trace whose answers failed throws** (`replay.ts:146`). Its `ReplayError` is not an `AskError`, so
    it escapes `run`, and the case gets no result. To do: repeat the recorded failure.
13. **An unknown pick label counts as stop** (`src/core/loop.ts:139`). A label that is neither a choice's nor `stop`
    ends the steps as `stop`, and the trace records the label as the pick's key. To do: count it as a failed pick.
14. **Replay knows a pick by the question id `next`** (`replay.ts:98-101`), which a domain could use for a question
    of its own. To do: refuse that id for a domain's question, or mark pick requests in another way.
15. **A resumed run does not compare the definition** (`commands.ts:121-122`). The check leaves out
    `definition.hash`, so a run can go on with another judge file. legal-judge works around it by putting the hash in
    its version. To do: compare the hash, and take it out of legal-judge's version.

**What a run records.**

16. **The `replay` command keeps nothing** (`commands.ts:176`). Its trace is written nowhere, so a fork's new picks and
    states are lost, and it prints no outcome or ending. To do: an `--out` that writes a trace and a result, as `run`
    does.
17. **A failed answer leaves no note in the trace** (`loop.ts:173`). The error goes only to `result.json`. The
    viewer's frames also put every note after the steps on the last step. To do: note the failure in the trace, and
    show notes after the steps on their own.
18. **Failed picks and cases that throw are missing from the results and the totals.** A failed pick is only a note in
    the trace, with `error: null` in `result.json`. `totals.failed` counts only `error`, and a case that throws gets no
    `result.json`, so `totals.cases` leaves it out. To do: record and count every case's failure.
19. **Repeated picks get made-up values** (`replay.ts:8`, `:132`). A `--state-from` run writes each repeated pick with
    probability 1, no confidence and 0 tokens, where the source trace has the real values. To do: copy the recorded
    pick, or mark it as repeated.
20. **The usage in the trace is counted twice and is incomplete** (`loop.ts:170`, `:204-205`). Each `stage` entry has
    its usage, and the `answers` entry repeats it. Retries after a request that was too long keep only the last
    attempt's usage, and a failed pick's usage is lost. To do: each entry records the usage of every request it made,
    once, together with the usage change above.
21. **The trace's `parent` is always the entry before it** (`src/core/trace.ts:133`), and nothing reads it. A fork
    writes a new trace, so a trace is never the tree that `trace.ts` describes. To do: remove `parent`, or write forks
    into the same trace.
22. **`requests.jsonl` has no schema.** The totals and `src/cli/source.ts` read it with a cast, where AGENTS.md wants
    a zod schema for data from outside the process. To do: a schema for the decision request and result above.

**The viewer.**

23. **The viewer hides the answers of a case without an outcome** (`viewer/src/web/panels.ts:87-88`, `:109-110`). It
    then shows only "The case ended without an outcome.". legal-judge gives no outcome, so its verdicts never show,
    and the session has no error either. To do: show the answers and the error in every case.
24. **"Model confidence" in the viewer is the pick's probability** (`viewer/src/web/model.ts:90`, `panels.ts:134`).
    The trace's `confidence` is the API's rescaled value, which the viewer never shows, and the chess README repeats
    the chart's name. To do: name the chart for what it shows, or plot the recorded confidence.
25. **The viewer uses switch's terms with other meanings:** `stage` for its drawing area, where switch has answer
    stages, "view" for what the page shows, where the view is what the model reads, and `endingOf` for the outcome,
    where `Ending` is why the steps ended. To do: other names in the viewer.
26. **Chess is still in the viewer.** `--stripe` and `--line` in its styles (`viewer/src/page.ts:60`) are used only by
    chess's stylesheet, and `viewer/README.md` describes the chess board, its sound button and its PGN download. To
    do: remove the two variables, and leave chess's description to its own README.

**Docs that disagree with the code.**

27. **legal-judge's README** says that `replay` uses "the judge file that the trace was made with" (line 131), and
    that `requests.jsonl` keeps each request "exactly as the model received it" (lines 66-67). Neither is true. To do:
    correct the texts, or check the trace's definition.
28. **A comment counts the retries wrong.** `loop.ts:239` says "sends a smaller view, up to three times", but
    `ATTEMPTS = 3` means three requests in all. To do: "up to three requests in all".
29. **The math doc's pick and score sections.** It gives a score the choice's confidence (`docs/MATH.md:112-113`),
    where System One uses the distance formula in `DECISION_MODEL_API.md`. It says that the API labels the choices and
    that θ is a temperature that one can set (lines 86-93), but switch makes the labels itself and passes no
    temperature. To do: correct both.
30. **The window.** The math doc and the README say that switch fits every request into the window
    (`docs/MATH.md:8`, `README.md:30`). switch only gives the view function a budget and retries: a state without a
    view function, an answer stage's fixed JSON and images are never cut, and τ₁ in the doc leaves out what the code
    subtracts for `extra`. To do: describe the budget and the retries.
31. **Chess's endings.** Chess calls the step limit "move limit" (`examples/chess/src/index.ts`), and its outcome gets
    only whether the model resigned, so a failed pick also comes out as "unfinished, move limit". Its README and the
    math doc say that the board is never stored, but the state keeps `fen`. To do: give the outcome `ended`, say "step
    limit", and correct the two texts.
32. **The README's first lines** say that a decision model "reads a state" and picks "one of a list of options", and
    `package.json` calls switch "a harness" that works "by choosing from steps". AGENTS.md reserves "state" and bans
    "option". To do: the current terms.
33. **AGENTS.md's boundary** says that file work stays in `ingest/`, `load.ts`, `setup.ts` and `viewer.ts`, but
    legal-judge's `definition.ts` and `score/scores.ts` read files too. To do: correct the text, with item 7.
34. **The Node version.** The README and `package.json` ask for Node 22.13, but the examples and the viewer run from
    TypeScript sources, and Node strips types without a flag only from 22.18. Not yet checked. To do: check, then
    raise the version or add the flag.

**Names and repeated values.**

35. **The pick has three names:** the purpose `"choose"`, the question id `"next"` and the trace's `pick`. To do:
    "pick" everywhere.
36. **View functions repeat the characters per token.** Chess has `CHARS_PER_TOKEN = 3` and legal-judge
    `charsPerToken: 3`, while the decider has its own value, which the replay decider sets to 4. To do: give the view
    function the decider's value, or an estimate function.
37. **switch makes its own key variable**, `${PROVIDER}_API_KEY` (`src/cli/program.ts:30-38`), whose names differ from
    pi-ai's for some providers, such as `CLOUDFLARE_API_KEY`. To do: pass a key only for `--api-key-env`, and let
    pi-ai find the others.
38. **Unused exports and a repeated check.** `traceEntrySchema` and `setSchema` are used only in their own files,
    `startOf` only in a test, and the viewer exports `VIEW_PORT`, `caseSession`, `savedPage` and `viewServer`, which
    nothing outside it uses. The check that a trace starts with its start entry is written three times, in
    `trace.ts`, `replay.ts` and `viewer/src/frames.ts`. To do: remove the unused exports, and use `startOf`.
39. **Two kinds of `LIMITS`.** legal-judge's `LIMITS` holds its own sizes, but chess's `LIMITS` is switch's `Limits`.
    To do: another name in legal-judge, such as `SIZES`.

### How the build did them

The build follows the items above, with these choices:

- **Replay in the loop.** A replay is no longer a decider that pretends to be a model. The loop takes each recorded
  pick by its key, copies its probabilities and confidence and marks it `repeated`, takes the recorded states, ends
  where the recorded steps ended, and repeats the recorded answers or their failure. `replayOf(entries, { fork })`
  repeats a fork's steps, and `replayOf(entries, { askAgain: true })` is `run --state-from`. This fixes items 9 to 14
  and 19 at one place. A whole replay runs with `recordedModel`, which the loop never asks.
- **The trace.** It keeps no usage: the requests file keeps every request's usage once, which settles item 20. Its
  entries have no `parent` and no `id`, since neither was read. It ends with an `end` entry: why the steps ended, and
  why the answers failed. A failed answer thus leaves its error in the trace.
- **Failures.** A case that throws gets a `result.json` with its error and no ending, and a note at the end of its
  trace; a run that goes on runs it again. `run.json`'s totals count it, and every failed pick, as failed.
- **`replay --out`.** It writes the replay as a run folder of one case, with `replay: { trace, fork }` in `run.json`.
- **The pick.** Its question id and the view function's purpose are both `pick`. A domain question with that id is
  refused.
- **Names.** `HarnessDomain`, `domainOf` and `domainNamed` became `DomainSetup`, `setupOf` and `runnerNamed`.
  `Exchange` became `RecordedRequest`, read with `parseRequests`. In the viewer, the `stage` hook became `draw`, its
  area `.drawing`, `endingOf` became `outcomeOf`, and "Model confidence" became "Probability of each pick". In chess,
  a piece's `kind` became `type` and `SoundKind` became `SoundEvent`; in legal-judge, a file's `kind` became `format`,
  in `case.json` too, so case folders are ingested again.
- **The view function** gets the decider's characters per token as its fourth argument, and measures with switch's
  `estimateTokens`.
- **Versions.** Both examples' versions are 0.5.0, since their traces and outcomes changed. legal-judge's version no
  longer holds the judge's hash, which `run.json` records as the definition's.
- **Node.** switch asks for Node 22.18, the first 22 release that runs TypeScript sources without a flag.
- **Item 26.** `viewer/README.md` still names the chess example's part, as the main README names the examples: it
  points to an example, and the viewer's code knows nothing of it.

## Out of scope

- Saving only what changed between two states, in place of each whole state. A later PR can do it if traces grow too
  large.
- Publishing switch to npm, and a repository for each example.

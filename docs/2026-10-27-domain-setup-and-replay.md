---
title: Domain setup and exact replay
author: Onur Solmaz
date: 2026-10-27
---

# Domain setup and exact replay

## TL;DR

The chess domain needed almost no change to the core loop, but it showed three gaps around the loop. Half of each
domain's code is in the command line. Every run records a "judge", also for chess. A replay runs the actions again,
so a game against Stockfish replays as a different game and reports no error. This change moves the per-domain code
into a setup that each domain exports, records a domain's definition in place of a judge, and makes a replay take each
observation from the trace. The requests that the two domains send to the model do not change.

## Background

switch has two domains. `legal-judge` gathers evidence and then answers one question for each rubric item. `chess`
plays a game: each step is a move, it asks no questions, and its result is how the game ended. The `Domain` interface
in `src/core/types.ts` worked for both. Chess needed one core change: a `data` field on menu options and observations
for the viewer, and the log in the run result.

The gaps are in the code around the loop. [The plan](2026-10-25-switch-plan.md) moves the domains to their own
packages after the second domain. These gaps must close first, because at the moment a domain cannot run without code
that only the command line has.

## Problems

### Per-domain code in the command line

`src/cli/domains.ts` has one hand-written entry for each domain. Each entry does five tasks that the `Domain`
interface does not cover:

| Task                | legal-judge                                                   | chess                                                                                          |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Find the definition | Loads the judge file that `--judge` names, or the default one | Puts its stop and choose texts and its limits in an object, and hashes it                      |
| Find the limits     | From the judge file                                           | From `LIMITS` in the domain                                                                    |
| Read the case id    | `loadCase(folder)`                                            | `loadCase(folder)` from chess's `load.ts`                                                      |
| Load the workspace  | `loadCase(folder)`                                            | `loadGame(folder)`, which starts Stockfish when the case plays it                              |
| Report the case     | The category of each rubric item                              | `outcomeOf`, after a search of the trace for the stop choice to find out if the model resigned |

A third domain needs a third entry. The resignation check reads the trace to find a fact that the loop knew and did
not return.

### A judge record for every domain

`run.json` has a `judge` field with a name, a hash and the definition. For legal-judge, this is the judge file. Chess
has no judge, so its entry makes one from its two texts and its limits. The `--judge` option of the command line has
the same problem: it is a generic option that only one domain uses.

### Replay runs the actions again

`replay`, `replay --fork` and `rejudge --from` repeat a trace with `replayDecider`. That decider repeats the recorded
choices, and the loop runs each chosen action again. The result is the recorded run only when each action always
gives the same result. A chess game against Stockfish does not: the move action asks the engine for its reply, and
with a time limit for each move, Stockfish does not always pick the same move.

A check replayed the recorded game where Jev plays white against Stockfish 19. Stockfish answered move 8 with a
different move. The decider finds a recorded choice by the text of its option, and 9.Bxf7+ was a legal move in the new
position too. So the replay went on in a different game and ended one move earlier. It reported no error.

| Move | Recorded        | Replayed      |
| ---- | --------------- | ------------- |
| 1–7  | e4 e5 … d6 Bxd6 | The same      |
| 8    | Bc4 b5          | Bc4 **Nf6**   |
| 9    | Bxf7+ Kxf7      | Bxf7+ Kxf7    |
| 10   | Rf1 Qe7+        | Rf1 Qe7+      |
| 11   | Kd1 Bc6         | Kd1 **Rae8**  |
| 12   | Re1 Bxf3+       | Re1 **Qxe1#** |
| 13   | Re2 Qxe2#       | None          |

Games against the random opponent replay correctly, because the seed sets its moves. The legal-judge actions only read
files, so their replays are also correct, but each replay reads and searches the case files again.

## Changes

### Domain setup

A new core module, `src/core/setup.ts`, defines what a program needs to run a domain on case folders:

```ts
/** A domain with what a program needs to run it on case folders. */
export interface Setup<W> {
  readonly domain: Domain<W>;
  /** Every text the model reads that does not come from the case, and the limits, with a name and a hash. */
  readonly definition: Definition;
  readonly limits: Limits;
  /** The case id in a case folder, read without loading the whole case. */
  caseId(folder: string): Promise<string>;
  /** The workspace of a case folder. */
  load(folder: string): Promise<W>;
  /** Each question's category, for reports. */
  categories?(workspace: W): Readonly<Record<string, string>>;
  /** How the case ended in the domain's own terms, such as a game's result. */
  outcome?(workspace: W, result: RunResult): JsonObject;
}
```

`runnerOf(setup)` makes a `Runner` from a setup. A runner hides the workspace type, so a program can keep the runners
of different domains in one list. The runner's `run(folder, decider, options)` loads the case, runs the loop, and
returns the `CaseRun` that the command line writes as `result.json`. `CaseRun` and the runner move from
`src/cli/domains.ts` to the core.

Each domain gets a `setup.ts`. It makes the domain's runner from a definition file, or from the domain's own
definition when there is no file:

- `legalJudgeSetup(file)` in `src/domains/legal-judge/setup.ts` loads the judge file, or the default judge file.
- `chessSetup(file)` in `src/domains/chess/setup.ts` refuses a file and uses the chess texts and `LIMITS`.

`setup.ts` can import `load.ts`, so the rule that file and process work stays in `ingest/` and `load.ts` now also
includes `setup.ts`. `index.ts` and the actions do not change.

`src/cli/domains.ts` keeps only a list of the setup functions by domain name, and the ingesters.

### How a run ended

`RunResult` gets the field `ended`, which tells why evidence gathering stopped:

| `ended`      | When                                                    |
| ------------ | ------------------------------------------------------- |
| `stop`       | The model chose the stop option. In chess, it resigned. |
| `no options` | The menu was empty, for example at the end of a game.   |
| `step limit` | The run took the number of steps that its limits allow. |
| `no choice`  | The choice request failed, or the model gave no choice. |

The chess setup's `outcome` reads `ended` and does not search the trace.

### Definition record

A run records `definition` in place of `judge`:

```json
"definition": { "name": "legal-judge", "hash": "4be0…", "content": { "…": "…" } }
```

`content` is the definition: the full judge file for legal-judge, and the stop and choose texts and the limits for
chess. The hash is the SHA-256 of `content` as JSON, calculated as before. Thus the hashes and the versions of the two
domains do not change. `compare` labels each run with `name@hash`, as before.

The `--judge` option of `run`, `rejudge` and `replay` becomes `--definition`. A judge file is the definition of the
legal-judge domain, so `--definition judges/legal-judge-qualifiers.json` replaces
`--judge judges/legal-judge-qualifiers.json`.

### Replay from recorded observations

A replay takes each observation from the trace. `replayOf(entries, fork)` in `src/core/replay.ts` returns two things:
the decider that repeats the recorded choices, and a `Replay` that `run` takes in its options. `replayDecider` is no
longer exported.

With a `Replay`, the loop does these steps:

- It takes the start's observations from the trace, and does not call the domain's `start`.
- For each repeated step, it makes sure that the chosen option has the recorded key, and takes the recorded
  observation. It does not run the action.
- It runs the domain's `start` or the action again when the recorded observation has images, because a trace keeps
  only the labels of images. If the new observation is different from the recorded one, the replay stops with a
  `ReplayError`.
- After a fork, it runs every action as usual, because from there the model chooses new steps.

| Command                | Before                                                    | After                                          |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `replay`               | Runs the action of each recorded step again               | Repeats the recorded observations              |
| `replay --fork <n>`    | Runs the actions of the first n steps again, then goes on | Repeats the first n observations, then goes on |
| `rejudge --from <run>` | Reads and searches the case files again, then judges      | Repeats the recorded evidence, then judges     |

With this change, a replay of the chess game above repeats the recorded game move by move. A fork after step 7 starts
from the recorded position before 8.Bc4, and asks Stockfish only for the new moves. A legal-judge replay does not read
or search the case files again, except for the images that the model looked at.

A replay no longer checks that the current code makes the same observations, except for the steps with images. No
document promised that check, and the trace is the record of what the model saw.

### Categories

The review before this change proposed to move `categories` into the legal-judge result. It stays in `result.json`
as a generic field, which a setup fills with `categories`. A question's category is a fact about the domain's
questions, `score` can read it for each domain that has scored questions, and the `result.json` files written before
this change keep it.

## What stays the same

- The `Domain`, `Action` and menu interfaces, and the order of the loop.
- The requests that the two domains send to the model, byte for byte.
- The trace format. A trace written before this change replays with the new code.
- The domain versions, `0.3.0` for chess and `0.3.0 <judge>@<hash>` for legal-judge, because the behavior of the
  domains does not change.

## Breaking changes

- `--judge` becomes `--definition`.
- `run.json` has `definition {name, hash, content}` in place of `judge {name, hash, definition}`. `compare`, and a run
  that continues in a folder where it stopped, read `run.json`, so they refuse a run folder from before this change.
  `score`, `view` and `rejudge --from` read only `result.json` and the traces, so they still read old run folders. To
  make an old `run.json` readable, rename its `judge` field to `definition`, and the `definition` field in it to
  `content`. switch has no reader for the old field.
- Code that imports `replayDecider` uses `replayOf`. Code that imports `CaseRun` or `DomainEntry` from
  `src/cli/domains.ts` imports `CaseRun` or `Runner` from the core.

## Tests

- Core: a replay repeats the recorded observations and does not run the actions. It runs an action again when the
  recorded observation has images, and refuses an observation that is different. It refuses a chosen key that is
  different from the recorded one. A fork runs the actions after the fork. `ended` has each of its four values.
- Chess: a replay of a game against an engine whose replies change gives the recorded game, and a fork asks the engine
  only after the fork. The setup refuses a definition file and reports the outcome, a resignation included.
- Legal judge: the setup's definition record and categories. `rejudge --from` still sends only the judging requests.
- Command line: `run.json` records `definition`, and `--definition` gets to the setup.

## Out of scope

- The viewer's own copy of the chess step format in `src/view/web/model.ts`. That is the next change.
- The move of the domains to their own packages.
- The ingesters, which stay a list in `src/cli/domains.ts`.
- `replay --domain`, which still defaults to legal-judge, although the trace records the domain.
- The result of a game in the trace. It stays in `result.json`.
- A replay of a game against Stockfish still needs `STOCKFISH`, because the load of the case starts the engine to get
  its name.

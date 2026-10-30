# Domains and harnesses

## TL;DR

A domain gives each case as a state machine: `initial`, `questions` and `transition`, and optionally `view`. The
`picking` helper turns a list of choices into one pick question per state. A harness wraps a domain's setup in
`commandLine`, which gives it switch's `run` and `replay` commands. This doc has the rules that the README leaves out.

## Questions and picks

The questions of a state are pi-ai's, by id: a `bool`, a `choice` or a `score` question, each with its `criteria`.
Every answer comes with the model's probabilities. A domain may ask several questions in one step, such as one about
each part of an item; switch splits them into batches when they do not fit one request. A choice question with one
option needs no model, so switch answers it with that option and sends no request for it.

`picking` turns a choice function into the question function and the transition function of a pick in each state. It
checks that the choices' keys and texts differ, keeps at most `limit` of them, the ones of lowest priority value,
labels them `o1`, `o2` and so on, and gives the transition the picked choice. A state with no choices asks nothing,
which ends the run.

switch adds no stop choice. A domain that wants one gives it among its choices with a low priority, so that a cut
keeps it, and its transition gives a state that asks nothing. switch does not know which picks were made before, so a
choice function must leave out what the state says is done.

A domain with several types of choice can give each type in a file of its own with `choiceType`, and join them with
`joinTypes`, which gives `picking` its choice function and its transition. A type's transition gets the picked
choice's key, which `typedKey` makes from the type and the key within it, so the state can record what is done under
the same key that the choice function leaves out.

## Views and limits

Without a view function, the model reads the state as it is. A view function gets the most tokens that its view may
take and the decider's characters per token, so it can measure with `estimateTokens`. When the model says that a
request was still too long, switch asks the view function for a smaller view.

The limits are `windowShare`, the share of the model's window that a request may fill, and `steps`, the most steps of a
run. `steps` is a safety net against a run that never ends, and it is off unless the domain sets it. A domain that
must ask something last, before a limit of its own, counts its steps in its state.

## Run results

`run` returns the run's result. `result.state` is the last state, and `result.trace` holds every state, the questions
of every step, and the answers with the model's probabilities. `result.ended` tells why the run ended: `done` when the
domain asked nothing more, `step limit`, or `failed` when a request failed or gave answers that do not fit its
questions, with the reason in `result.error`.

## Harnesses

A harness is a program that runs a domain on case folders. Its setup function returns a runner from `runnerOf`, which
holds what every case shares, how to read a case's id, how to load a case folder's state machine, and, when the domain
has one, its outcome.

The definition holds what a domain lets a run vary, such as the texts that tell the model what to do, and the limits.
`run.json` records it with its hash, and each trace starts with that hash and the case's id. By default, the
definition is the domain's limits; a domain set up from a file of its own, such as rubric-judge's judge file, gives
that file. The texts in the domain's code, such as those of its choices, come with the domain's version.

`commandLine` is a [Commander](https://github.com/tj/commander.js) program, so a harness can add its own commands, as
rubric-judge adds `ingest`, `score` and `compare`, and the examples add the viewer's `view`. Each domain of a harness
is a `DomainSetup`: its setup function, and its own flags, which `run` and `replay` then take; `setup` gets their
values by name. For example, rubric-judge declares `flags: [{ flag: "--judge <file>", description: "…" }]` and reads
the judge file from `flags["judge"]`. A harness with more than one domain takes `--domain` to pick one.

The model's API key comes from the environment variable that `--api-key-env` names, or pi-ai finds the provider's
own, such as `TYPESAFE_API_KEY`.

## Run folders

`run --out <folder>` writes one run folder. `run.json` records what ran, the limits that the cases ran under, and, at
the end, the totals: the cases, the failed ones, the requests and their summed usage, cost included. Each case has its
`result.json` (its steps, why the run ended, why it failed, the domain's outcome, and the error that stopped the case),
its `trace.jsonl`, and its `requests.jsonl`, with every decision request and its result. When a stopped run goes on, it
runs again each case that has no result, or whose case was stopped by an error.

## Replay

`replay` runs a case again from its trace, under the trace's limits. It takes each recorded answer and each state from
the trace, so no transition runs and no model is asked, and it ends as the recorded run ended. A replay thus gives the
recorded case even when a transition would find something else now, such as a chess engine's reply.

A replay fails when the trace is of another domain or case, or when the domain's code no longer asks the questions
that the run answered: other ids or types, a recorded pick whose choice is gone, questions where the run ended, or none
where it asked. A recorded pick is found by its choice's key, so a choice whose text or label changed since still
fits. A definition that changed since is noted in the replay's trace.

With `--fork <n>`, `replay` repeats only the first n steps, and the model that `--model` names answers from there,
with the transitions running again. With `--out <folder>`, it writes the replay as a run folder of one case, which the
viewer can show.

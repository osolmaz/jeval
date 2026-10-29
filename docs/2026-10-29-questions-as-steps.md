---
title: Questions as steps
author: Onur Solmaz
date: 2026-10-29
---

# Questions as steps

## TL;DR

switch gets one kind of step. In each state, the domain's question function says what the model must answer, the model
answers each question with probabilities in one decision request, and the transition function makes the next state
from the answers. A run ends when the domain has nothing more to ask, and its result is the last state. A pick becomes
one choice question, which a helper builds from the domain's choices, so the final questions, the answer stages and
`run --state-from` leave the core. The step limit stays only as a safety cap, which is off unless a domain sets it.

## Why one kind of step

Today switch asks the model about a state in two ways. At each step it asks for a pick, one choice question over the
choices of the state, and gives the picked choice to the transition function. After the steps, it asks the domain's
final questions over the last state and puts the answers into the result. Both are the same decision-model request,
a view and some typed questions, and pi-ai's classifier interface already takes many questions in one request. They
differ only in what happens to the answers.

Two ways mean two code paths in the loop, two kinds of trace entries, two kinds of replay and a command,
`run --state-from`, that exists only to ask the final questions again. Only rubric-judge uses the final questions, and
only rubric-judge uses `answer()`, the answer stages of a domain's own. With one kind of step, all of this is one loop,
and the judge's verdict is an ordinary step: the step that asks whether the answer meets and misses each rubric item.

## The formulation

Before, a domain gave an initial state $S_0$, a choice function $C$ and a transition function $T(S, c)$, and could give
final questions $Q$:

$$c_t \in C(S_{t-1}) \cup \{\text{stop}\}, \qquad S_t = T(S_{t-1}, c_t)$$

The steps ended when the model picked stop, when $C$ gave no choices or at the step limit, and then the model answered
$Q$ over the view of the last state $S_N$. A run's result was $S_N$ and the answers.

After, a domain gives an initial state $S_0$, a **question function** $Q$ from a state to the questions that the model
must answer in it, and a transition function $T(S, a)$ from a state and the answers to the next state. Step $t$ asks
$Q(S_{t-1}) = (q_1, \dots, q_k)$, and the model gives one answer to each question, each with its probabilities:

$$a_t = (a_{t,1}, \dots, a_{t,k}), \qquad S_t = T(S_{t-1}, a_t)$$

The run ends when $Q(S_t)$ is empty, and its result is the last state. A pick is the case of one choice question whose
answers are the choices of a state, and a final question is a question of the last step that asks anything; the old
formulation is the new one with a pick in each step and the final questions in one more step.

What an answer is, and how its probabilities come from the model's scores, belongs to the decision-model API and not to
switch: `docs/DECISION_MODEL_API.md` gives the answers of pi-ai's `bool`, `choice` and `score` questions, and a type
that pi-ai adds later works in switch with no change. switch can use only what pi-ai offers, so System One's `box`
questions and the probabilities of a score answer stay out. The probability of a run's path is the product of the
probabilities of the labels that its choice answers named; a bool or a score answer names no label, so it adds no
factor.

## The interface

```ts
interface StateMachine<S extends JsonObject> {
  initial(): Promise<S>;
  /** The question function: what the model must answer in a state, by id. Nothing to ask ends the run. */
  questions(state: S): Questions;
  /** The transition function: the next state, from the state and the model's answer to each question. */
  transition(state: S, answers: Answers): Promise<S>;
  /** The view function: what the model reads in a state, in at most `tokens` tokens. */
  view?(state: S, tokens: number, charsPerToken: number): Promise<View>;
}
```

A domain decides in each state what to ask: a pick, other questions of any type, both, or nothing. The answers of a
step do not go straight to the questions of the next step. They go into the transition function, which writes what it
needs into the next state, and the question function reads that state. Because everything passes through the state,
the trace still keeps enough for an exact replay.

The pick keeps a helper in switch. `picking` takes a choice function, the pick's instructions, the most choices that a
pick shows, and the transition of a picked choice, and gives the question function and the transition function of a
machine that asks one pick in each state. It checks the choices (keys and texts that differ), keeps the ones of lowest
priority value when there are too many, gives them the short labels `o1`, `o2` and so on, and finds the picked choice
again from the answer. A state with no choices asks nothing, which ends the run. `choiceType` and `joinTypes` stay as
they are, on top of `picking`. "Choice" now has the meaning that the API gives it: one allowed answer of a choice
question. The domain's own facts about each choice, such as a chess move's squares, go into the question's `data`,
which the trace keeps and the model never sees.

## Decisions

These were settled in the discussion of 29 October 2026.

1. **Stop.** switch no longer adds a stop choice to every pick. A domain that wants one puts it among its choices, with
   a priority that keeps it when the choices are cut, and its transition gives a state with nothing to ask. Chess has
   "Resign the game", WikiRace has "Give up and lose the race", and rubric-judge has its stop text, which now ends the
   gathering of evidence and leads to the checks. A game that ends by itself, by checkmate, stalemate or a draw, ends
   the run in the same way: its state says that the game is over, so the question function asks nothing.
2. **Repeated picks.** switch no longer refuses a choice that the model picked before in the run, because it does not
   know which answers are picks. A domain must leave out of its choices what its state says is done, as it must today.
3. **The step limit.** A domain decides when its run ends, so the limit on steps is only a safety net against a run
   that never ends, such as a race that goes in circles on a paid model. It is off unless a domain sets it, and a run
   that reaches it ends as unfinished, with nothing more asked. A domain that needs a last step, such as the judge,
   counts its own steps in its state and asks its last questions before its own limit.
4. **`run --state-from`.** It goes, because there are no final questions to ask again. `replay --fork` repeats the
   steps of a trace up to any step and lets the model answer from there, which also asks a last step again.
5. **The replay check.** A replay takes each recorded answer and checks that it fits the question that the domain asks
   now in the recorded state: the same ids and the same types. For a pick, the recorded choice must still be among the
   choices, found by its key, and the answer takes the choice's label now. So a fork under another definition, such as
   a judge file with another stop text, still repeats the recorded picks. For any other choice question, the picked
   label must have the text that the trace recorded. This is today's check that a recorded pick is among the choices,
   for every type. It fails, as today, when the domain asks nothing where the run asked, or asks where the run had
   ended.
6. **The context.** The view function stays the way that a domain chooses what goes into the model's context. switch
   gives it a budget of tokens, and when the model says that a request was too long, switch asks for a smaller view. It
   loses its `purpose` argument: the state says which step the case is in.
7. **Many questions.** When the questions of a step do not fit one request, switch splits them into batches, which
   share the view, as it does today for the final questions.

## The records

- **Trace.** The entries are `start`, `state`, `questions` (the step and its questions, before the request), `answers`
  (the step and its answers, after it), `ended`, `note` and `thrown`. The `choices`, `pick` and `stage` entries go. An
  `ended` entry says why the run ended, `done`, `step limit` or `failed`, how many steps it took, and why it failed.
  Old traces are not read.
- **A case's result.** `result.json` keeps the case, the model, the steps, why the run ended, why it failed and the
  domain's outcome. Its `answers` go: a domain's outcome reports what the last state holds, such as the judge's verdicts.
- **A run's record.** `run.json` loses `stateFrom`, and its limits are `windowShare` and an optional `steps`.

## The examples

- **Chess** asks one pick in each state while the game is on, with "Resign the game" among the moves. A resignation is
  a status of the state, as checkmate is.
- **WikiRace** asks one pick in each state until it reaches the target, with "Give up and lose the race" among the
  links and sections. Giving up is a field of the state.
- **rubric-judge** gathers evidence with one pick in each state. Its stop choice, which has the judge file's stop
  text and is always among the choices, or the most gathering steps of its judge file moves it to the check step,
  which asks every rubric item's meets and misses questions in one step. The transition writes their probabilities into the state, and the domain's outcome
  joins them into each item's verdict, which `score` and `compare` read from `result.json`.

## Work

One pull request changes the core types and the loop, the pick helper, the trace, replay, the record of a run, the
command line, the fake decider, the viewer and its pages, the three examples and their tests, the README's "How it
works" and its domain example, `docs/MATH.md` and the terms in `AGENTS.md`. After the merge, a reviewer that did not
write the change looks for leftovers of the old interface.

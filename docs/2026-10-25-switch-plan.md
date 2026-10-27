---
title: switch plan
author: Onur Solmaz
date: 2026-10-25
---

# switch plan

## TL;DR

switch is a harness that lets a decision model, such as TypeSafe's Jev, work through a multi-step task. At
each step code lists the steps that are allowed, the model picks one, and code runs it, until the model can
answer typed questions about the case. A prototype that graded legal answers this way got 94.6% of 1,288
rubric items right on a labeled eval, as many as the best chat-model judge, at about 0.3 seconds a call.
The plan is a small core with five building blocks, domains declared as packages, control from the model's
own probabilities, and replayable traces, built and measured in six phases.

## What switch is

Decision models do not write text. They read a JSON state and answer typed questions: pick one of several
choices, answer yes or no, or give a score, each with a probability. TypeSafe's Jev is one; Cloudflare's
Clef and the decision models that llama.cpp serves are others. They are fast and cheap, and their
probabilities are calibrated, but they cannot write a tool call or a shell command, so the usual agent loop
does not fit them.

switch gives them a loop that does fit. Code builds the menu of steps that make sense in the current state,
the model chooses one with a `choice` question, code runs the step and adds what it found to the state, and
the loop ends when the model chooses to stop or a budget runs out. The model then answers the case's
questions. Grading an answer against a rubric is the first use, but nothing in the core is about grading:
the same loop can route a request, sort a report into categories or decide whether a case needs a person.

## Evidence from the prototype

The design comes from a prototype that graded saved answers to legal tasks: contracts to redline, clauses
to draft, facts to extract from scanned filings. Three findings shaped it.

### What a strong judge does

Before the prototype, 682 sessions of a chat-model judge (GPT-6.1 Sol in an agentic harness with a shell)
were sampled across 359 tasks, 6,210 tool calls in all. The judge took a median of 8 calls, of which a
median of 3 gathered evidence. It nearly always worked in the same order: read the request and the rubric,
list the files, read the answer, read some documents, write the verdicts.

| Step                                                              | Sessions that took it |
| ----------------------------------------------------------------- | --------------------- |
| Read the answer                                                   | about 100%            |
| Open the task's documents, when the task had any                  | 97%                   |
| Turn a PDF, a Word file or a spreadsheet into text                | 44%, 38%, 6%          |
| Search for terms                                                  | 31%                   |
| Count words, usually in one section                               | 26%                   |
| Compare an edited contract with the original                      | 21%                   |
| Check formatting in a Word file (bold, tracked changes, comments) | 21%                   |
| Look at images, render pages, do arithmetic                       | 2% to 3% each         |

The judge opened a median of a third of the documents when there were two or more, so choosing which file
to read matters. About half of its search terms came word for word from the rubric item; the rest were
clause numbers, dates and names from the answer or the documents. This list of steps became the first menu.
switch does not have to copy the judge's path; it has to reach verdicts as good.

### A decision model without the documents

Jev, given only the request and the answer's text, agreed with the chat-model judge's stored verdicts on
82.1% of 470 rubric items (kappa 0.65) and passed more of them (59.8% against 46.6%). Most of its extra
passes were items where the answer covers the topic but misses one required part, which it could not
check against the documents it never saw.

### A decision model with a menu

The prototype gave Jev the menu: read a file or a range of its pages, look at a page image, search a term,
count words per section, list tracked changes and comments, compare an edited Word file with the original,
or judge now. It ran on a balanced split of 100 saved answers (1,288 rubric items) from an eval whose
reference labels come from strong models and a review. Two chat-model judges in an agentic harness had
graded the same answers earlier.

| Judge on the same 100 answers                          | Items right | False passes | False fails | Whole answers right |
| ------------------------------------------------------ | ----------- | ------------ | ----------- | ------------------- |
| GPT-6 Luna, agentic harness                            | 93.5%       | 26           | 58          | 88.0%               |
| DeepSeek-V4.1-Flash, agentic harness (1 answer failed) | 94.6%       | 49           | 6           | 93.9%               |
| Jev with the menu                                      | 94.6%       | 49           | 21          | 93.0%               |

"Items right" counts a failed answer's items as wrong. Jev used a median of one step per answer and judged at
once on 43 answers, mostly drafting tasks with no documents. The 100 answers took 325 calls, a median of
0.3 seconds each, and 3.3 million input tokens. It was weaker on citation items (89%, against 96% and 100%),
and twice a step request went over the model's window because the size estimate was too low; both answers
still got verdicts from the evidence gathered before. This was one run with no repeats, on answers that
earlier judge work had already seen, so it is not a held-out result.

## Formal model

A domain describes a kind of problem; a case is one instance of it. The split comes from PDDL, the
planning language, where a domain file declares the action schemas and a problem file gives the objects
and the goal.

A domain is a tuple of four parts:

$$D = \langle W, A, Q, \varphi \rangle$$

- **W, the workspace type.** A case's workspace is immutable and content-addressed: the files of the task
  and of the answer, for a judge, already split into pages, paragraphs, sheets and images.
- **A, the action schemas.** Each schema $a$ has five parts. `when(W, Σ)` says whether the action is
  available. `options(W, Σ)` lists its concrete choices θ, each with the text the model sees and the
  questions it informs. `observe(W, θ)` returns what the step found; it only reads. `cost(θ)` says what the
  step costs in tokens or money.
- **Q, the questions.** Typed `bool`, `choice` or `score` questions, each with its instructions. For a judge,
  one `bool` per rubric item.
- **φ, the view.** A function from the workspace and the observation log Σ to the JSON state the model sees,
  under a token budget. It marks anything it leaves out; it never cuts text without saying so.

A run starts from the observations that every case needs, such as the answer's text for a judge, and then
repeats one step:

```
Σ₀ = init(W)
repeat:
  menu  = { (a, θ) : a ∈ A, when_a(W, Σ), θ ∈ options_a(W, Σ) } ∪ { STOP }
  a, θ  = argmax π_M(· | φ(W, Σ), menu)        one `choice` call to the decision model M
  Σ     = Σ ⊕ observe_a(W, θ)                  code, deterministic
until STOP or the budget is spent
answer  = M(Q | φ(W, Σ))                       typed answers with probabilities
```

The menu is the set of filled-in schemas whose conditions hold, exactly the set of applicable actions A(s)
of a planning problem. The model's choice probabilities are the policy π, and the observation log only
grows. Seen as a decision process, this is a Markov decision process with a finite, state-dependent action
set and deterministic transitions, whose reward at the end is the quality of the answers minus the cost
spent. In the machine learning literature the same problem is active feature acquisition, or sequential
hypothesis testing: buy observations until you are sure enough to decide.

### What the planning view adds

Two ideas from planning fit our case better than plain PDDL.

- **Actions that find things out.** Classic PDDL assumes every effect is known before the action runs, so a
  planner can search ahead. A search's result is unknown until it runs. Planning with sensing actions
  handles this, and the knowledge-level planner PKS (Petrick and Bacchus, 2002) lets a goal be "know
  whether X" instead of "make X true".
- **A goal about knowing.** A judge's goal is: for every rubric item, know whether it passes. In switch,
  "know" means the model's probability for the item is far from 0.5. That gives the stopping rule below
  directly from the formal model.

What switch takes from PDDL: the domain and case split, typed parameters, conditions on actions, and
filling the schemas in to get a finite menu. What it leaves out: PDDL's syntax, because options and
observations need real code, and the planner's search, because the decision model is the policy and acts
one step at a time.

## Building blocks

The core knows five things and nothing else.

| Building block | What it is                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Action schema  | `name`, `when`, `options`, `observe`, `cost`; each option carries its text, its argument and the questions it informs |
| Observation    | What one step found, with its source, its size in tokens and a content hash                                           |
| Question       | A typed `bool`, `choice` or `score` question with instructions and the text of each answer                            |
| View           | The function that turns the workspace and the observation log into the model's state, under a budget                  |
| Budget         | Limits on steps, tokens per request, total tokens, total cost and options per menu                                    |

Everything else is an extension built from these: rubric grading, belief-based stopping, the cascade,
OCR, a Word file comparison.

## Core loop

The core runs the loop above and owns the parts that every domain needs.

- **Menu.** It calls every registered schema, collects the options, ranks them and keeps at most the
  budget's option limit (the prototype used 30). When it has to drop options, it drops later parts of a
  file before first parts, then the last search terms. STOP is always on the menu, worded by the domain,
  for example "Judge now: the evidence is enough".
- **Choice.** One `choice` question whose answers are the menu's texts. The trace keeps every option's
  probability, not only the winner's.
- **Observation.** The chosen step's `observe` runs and its result joins the log. A step that has run
  leaves the menu, so the model cannot pick the same step again; one known problem of tool-using decision
  models is exactly that loop.
- **Window.** The core counts tokens with the model's own counting when the provider offers it, and with a
  safe estimate when it does not. If the provider still reports that a request is too long, the core asks
  the view for a smaller state and tries once more, and records that it did.
- **Answers.** The questions go out in as few requests as the window allows, each with the same state.
- **Failures.** A failed choice call ends evidence gathering and goes on to the answers with the evidence
  so far. A failed answer call is a failed case, recorded as such; nothing is guessed.

## Control from probabilities

Because the model's probabilities are calibrated, they can steer the run. These are extensions, each
adopted only after it is measured.

- **Belief-based stopping.** At each step, ask the questions Q as well, which is cheap, and keep each
  question's probability $p_i$. Stop when every $p_i$ is outside a band such as $[0.2, 0.8]$, not only when
  the model picks STOP. This is the "know whether" goal made concrete.
- **Targeted menus.** Each option says which questions it informs. Offer first the options that inform the
  questions whose $p_i$ is closest to 0.5. This is a cheap stand-in for choosing the step with the largest
  expected information gain.
- **Cascade.** A question that is still uncertain when the budget runs out goes to a stronger and dearer
  judge, such as a chat model in an agentic harness. In the literature this is selective prediction: the
  decision model settles the easy majority and the expensive judge sees only the doubtful items. The number
  to report is accuracy against the share of items sent on.

## Traces

Every run writes one trace, a JSON Lines file of entries that each name their parent, the same tree shape as
Pi's session files.

| Entry         | What it holds                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `case`        | The domain and its version, the workspace's content hash, the model and its version, the budget |
| `menu`        | Every option's text, schema, argument and informed questions                                    |
| `choice`      | The chosen option and every option's probability                                                |
| `observation` | The step's result or its content hash, and its size                                             |
| `beliefs`     | The questions' probabilities, when belief-based stopping is on                                  |
| `answers`     | The final typed answers with their probabilities                                                |
| `usage`       | Tokens, time and cost of each model call                                                        |

A replay repeats the recorded choices and takes each step's observation from the trace, so it is exact even when an
action asks a program outside the workspace, such as a chess engine; see
[Domain setup and exact replay](2026-10-27-domain-setup-and-replay.md). Forking a trace at step
k with a different choice gives a counterfactual run: what would another choice have changed, or what would
another decision model have done on the same path. Traces are also the data to compare models, to tune the
menus and, later, to train a decision model on.

## Models

The model sits behind pi-ai's classifier interface (`classify`), so any classifier that pi-ai lists can
drive switch: Jev from TypeSafe and the providers that resell it, Clef on Cloudflare Workers AI, the decision
models that llama.cpp serves, and a chat model used as a classifier, which reads answers from next-token
probabilities. Images go with the state for models that accept them. A run records the model's exact
identifier and, where the provider returns it, the served version, because a name such as `jev-latest`
moves.

## Domains

A domain is a package. Like a Pi extension, it registers its parts with the core and the core never changes
for it.

```
domain-legal-judge/
  src/index.ts             registers the actions, questions and view below
  src/workspace.ts         W: task files and answer files split into pages, paragraphs, sheets and images
  src/view.ts              φ: what the model sees, under the token budget
  src/questions.ts         Q: one bool question per rubric item
  src/actions/read.ts      read a file, or a range of its pages
  src/actions/page-image.ts
  src/actions/search.ts
  src/actions/word-count.ts
  src/actions/tracked-changes.ts
  src/actions/compare-docx.ts
```

One action, declared in its own file:

```ts
// src/actions/search.ts
export default action({
  name: "search",
  when: (s) => s.unsearchedTerms().length > 0,
  options: (s) =>
    s
      .unsearchedTerms()
      .slice(0, 10)
      .map((t) => ({
        text: `Find the passages in the answer and the documents that mention “${t.term}”`,
        arg: t,
        informs: t.items,
      })),
  observe: (w, t) => w.search(t.term, { hits: 8, context: 280 }),
  cost: () => ({ tokens: 600 }),
});
```

Schemas are code, not configuration, because their options depend on the state and their observations need
real work, such as PDF text or a Word file comparison. A task never holds a menu: a benchmark task holds only
its data, and the domain builds the menu from it, so one domain serves every task of its kind.

A domain can be checked without a model call. Every question must be informed by at least one schema, every
schema must inform at least one question, and every option text must be unique within a menu.

Domains ship as npm or Git packages, in the way Pi packages ship, and a run names the domain and its version.

## Modes

- **SDK.** The core is a TypeScript library; the other modes are built on it.
- **Command line.** `switch run --domain <package> --case <dir>` writes the trace and prints the answers as
  JSON.
- **Interactive.** A person watches each menu with its probabilities and can override a choice or an answer.
  The same screen is a labeling tool: a person's answers become reference labels, with the trace as the
  record of what they saw.
- **Harbor verifier.** For a judge domain, an adapter runs switch as a Harbor verifier, so a benchmark can be
  graded by switch and a judge eval can measure it.

## Principles borrowed from Pi

Pi's own design is the model for switch's: its core is minimal, its features are primitives that extensions
build on, and it lists what it chose not to build.

| Pi                                                                         | switch                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A minimal core; a feature that does not belong in the core is an extension | The core is only the loop and the trace                                                  |
| Primitives, not features                                                   | Five building blocks; grading, stopping rules and the cascade are extensions             |
| Adapt the harness to the work, not the other way around                    | A domain declares its actions, questions and view; the engine never changes for a domain |
| Packages from npm or Git                                                   | Domain packages                                                                          |
| A minimal system prompt, so the user does the context engineering          | A tiny fixed framing; the domain's view is its context engineering                       |
| Interactive, JSON, RPC and SDK modes                                       | SDK, command line, interactive and Harbor verifier modes                                 |
| Sessions as JSON Lines entries in a tree                                   | Traces in the same shape, with replay and forks                                          |
| A list of features left out on purpose                                     | The list below                                                                           |

Pi's agent loop itself does not carry over: it expects a model that writes free text and tool arguments. A
decision model can only pick from a finite list, so in switch code writes every option.

## What switch leaves out

- **Free-form tool arguments.** Every option is written by code; the model only chooses.
- **Side effects in actions.** Actions only read the workspace. A decision with an effect, such as sending a
  case to a person, is a typed answer that the host program carries out. So switch needs no permission
  prompts and no sandbox for its own steps.
- **A planner.** The decision model is the policy; there is no search ahead.
- **Rubric logic in the core.** Grading is a domain.
- **Silent truncation.** A view that leaves something out says so in the state.

## First domain: legal judge

The prototype becomes the first domain package, `domain-legal-judge`.

- **Workspace.** PDF files become pages, with a PNG render of every page that has no text layer, and OCR
  text when the case provides it. Word files become numbered paragraphs and tables, with their tracked
  insertions and deletions, comments, and text with direct bold, italic, underline, strike or highlight.
  Spreadsheets become rows per sheet, emails their headers, bodies and attachment names, slide decks their
  text per slide, legacy `.doc` files text through LibreOffice, and images stay images.
- **Actions.**
  - Read a whole file when it fits; otherwise read a range of its parts, about 6,000 tokens at a time.
  - Look at a page image or an image file, up to six images per case.
  - Search a term in the answer and the documents: up to eight hits with 280 characters on each side.
    Terms come from the rubric items (quoted text, amounts, durations, dates, clause references and
    capitalized names) and from the figures and clause references the answer cites. Terms that also
    appear in the documents come first, because a hit there checks the answer against its sources.
  - Count the answer's words in total and per section, offered when an item mentions length.
  - List the tracked changes and comments of a Word file: always for the answer, and for a document only
    when it has any.
  - Compare the answer's Word file with the original of the same name, paragraph by paragraph.
  - Judge now.
- **Opening state.** The answer's files, up to about 22,000 tokens, and the answer's formatting facts, read
  before the first choice.
- **Questions.** One `bool` per rubric item: "Does the submitted answer meet this rubric item?", with the
  item's pass rule applied exactly as written, equivalent wording passing, and the task's documents used to
  check facts, figures and citations.
- **Limits.** At most eight steps, about 40,000 tokens of evidence, 30 options per menu and six images.

## Evaluation

Every evaluation round is registered before any run: the cases, the configurations, the models and their
versions, the number of repeats, the budget and the criteria for going further.

- **Data.**
  - A labeled legal judge eval: frozen saved answers with a reference label for every rubric item, made by
    strong models and reviewed. It has a balanced 100-answer split (1,288 items) and a full set of 435
    answers.
  - An agreement set: saved answers to finalized tasks with the verdicts of a strong chat-model judge. It
    measures agreement with that judge, not accuracy, until people label it.
- **Configurations.** Jev with the answer only; Jev with the menu; the menu plus belief-based stopping;
  the menu plus the cascade.
- **Baselines.** Chat-model judges in an agentic harness on the same answers, and Pydantic AI's agent with
  Jev as its model, with switch's actions as its tools, run once to decide whether switch needs its own loop.
- **Measures.** Item accuracy over all scheduled items, with failed cases counted as wrong; false passes and
  false fails; Cohen's kappa; whole-answer accuracy; accuracy by item category; agreement between repeats;
  calls, tokens, time and cost per answer; and for the cascade, accuracy against the share of items sent
  on.
- **Target.** 95% item accuracy on the labeled eval, stable over repeats. For the cascade, accuracy close to
  the strong judge's at a small share of its cost.

## Phases

### Phase 0: repository and plan

This repository, with this plan, the MIT license and the standard GitHub settings.

### Phase 1: core

- The five building blocks, the loop, budgets, window handling, traces, replay and forks.
- The model interface on pi-ai's `classify`.
- Tests that use a fake classifier, so the core's tests make no model calls.
- TypeScript on Node 22, with Slophammer's TypeScript checker in CI from the first code commit.

Done when a fake domain runs end to end, its trace replays to the same answers, and the checks pass.

### Phase 2: legal-judge domain

- The prototype's workspace extraction, actions, questions and view, as a domain package.
- The domain checks above.

Done when the domain reproduces the prototype's result on the 100-answer split within noise.

### Phase 3: control from probabilities

Belief-based stopping, targeted menus and the cascade, each behind a setting.

Done when each one has been compared with the plain menu on the same answers, and kept only if it helps.

### Phase 4: evaluation round

The registered round above: all configurations, the baselines, repeats, and a written report with every
failed case kept.

### Phase 5: modes

The command line, the interactive mode with overrides and label export, and the Harbor verifier adapter.

### Phase 6: second domain

A second domain that is not a judge, such as routing a request to a model or sorting a report. switch's core
changes only if the second domain shows a gap; then the domains move to their own packages.

The second domain is chess. It showed three gaps around the loop, which
[Domain setup and exact replay](2026-10-27-domain-setup-and-replay.md) describes and closes: per-domain code in the
command line, a judge record for every domain, and replays that ran the actions again.

## Prior art

- **Decision-model agents.** Pydantic AI supports Jev as an agent model with tools, and warns that it tends
  to call the same tool again once that call is in the history. JevLoop rebuilds its candidate tools at each
  step and lets Jev choose one. jev-ultrafast lets Jev choose Browser Use's next action. A LangChain post
  describes a harness around Jev, and an arXiv paper uses Jev and Laya as the decision layer of penetration
  testing agents.
- **Planning.** STRIPS (Fikes and Nilsson, 1971), PDDL (McDermott and others, 1998), and planning with
  sensing actions and knowledge goals, such as PKS (Petrick and Bacchus, 2002).
- **Machine learning.** Active feature acquisition, sequential hypothesis testing, and selective prediction.
- **Pi.** The minimal, extensible agent harness whose principles switch follows, and pi-ai, whose classifier
  interface switch uses.

## Risks and open questions

- **Calibration across models.** The stopping and cascade rules assume calibrated probabilities. Each model
  needs a calibration check before its probabilities steer a run.
- **The window.** 64,000 tokens hold a large answer or a few documents, not both. The view's choices of
  what to keep matter as much as the model's.
- **Menu size and wording.** How many options a decision model handles well, and how much the option texts
  change its choices, is not known yet; both need measuring.
- **Search terms.** Term extraction from the rubric is crude and sometimes yields generic terms such as
  "the Parties".
- **Instructions inside the state.** A small model may follow text in the answer that reads like an
  instruction. The framing tells it to treat the state as data, which is not a guarantee.
- **Price and versions.** pi-ai does not receive the vendor's price for Jev, and a `-latest`
  model name moves, so a result must record the served version where possible.

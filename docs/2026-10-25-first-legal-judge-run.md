---
title: First legal-judge run
author: Onur Solmaz
date: 2026-10-25
---

# First legal-judge run

## TL;DR

Switch's `legal-judge` domain with Jev agreed with the reference labels on 94.6% and 95.0% of 1,288 rubric items in two
runs on the same 100 saved answers. That is level with the best of two chat-model judges in an agentic harness
(DeepSeek-V4.1-Flash, 94.6% over the same scheduled items) and above GPT-6 Luna (93.5%). A run took about 320 calls of
about 0.3 seconds each and 3.2 million input tokens.

## Setup

- **Data.** A balanced split of 100 saved answers to legal tasks, 1,288 rubric items, from a private judge eval whose
  reference labels come from strong models and a review. The tasks include clause drafting, contract redlines,
  extraction from scanned filings, and memos over data rooms. The answers were seen in earlier judge work, so this is
  not a held-out result.
- **Cases.** `switch ingest` turned each answer and its task into a case folder: 172 answer files, 71 PDFs (129 page
  images of pages without a text layer), 53 Word files, 12 emails, 8 spreadsheets, 11 text files and one slide deck,
  with no extraction errors.
- **Model.** `typesafe/jev-latest` through pi-ai 1.4.0, with the default limits: 8 steps, 30 options a menu and 90% of
  the 64,000-token window per request.
- **Runs.** One grading per answer per run. The second run used the code of the commit that adds this record, before
  two refactors that do not change behavior. The first ran before a fix that takes search terms from the answer's
  original text, so it missed terms such as the clause references an answer cites.

## Results

"Items right" counts every item of an answer without verdicts as wrong.

| Judge on the same 100 answers                          | Items right | Kappa | False passes | False fails | Whole answers right |
| ------------------------------------------------------ | ----------- | ----- | ------------ | ----------- | ------------------- |
| GPT-6 Luna, agentic harness                            | 93.5%       | 0.83  | 26           | 58          | 88.0%               |
| DeepSeek-V4.1-Flash, agentic harness (1 answer failed) | 94.6%       | 0.87  | 49           | 6           | 93.9%               |
| Switch prototype (a single script), Jev                | 94.6%       | 0.84  | 49           | 21          | 93.0%               |
| Switch, Jev, first run                                 | 95.0%       | 0.86  | 42           | 23          | 92.0%               |
| Switch, Jev, second run                                | 94.6%       | 0.84  | 49           | 21          | 91.0%               |

The two Switch runs differ by 5 items, which is within the variation between runs; they are a tie. By category, the
second run got form items 100%, substance items 94.4% and citation items 92.9% right.

## How Jev used the menu

In the second run Jev chose to stop on 97 of the 100 answers and reached the step limit on the other three. It took a
mean of 1.2 steps per answer: 79 reads of a file or part of one, 22 looks at a page image, 18 searches, one word count
and one list of tracked changes. More than half of the answers were judged with the answer alone, mostly drafting
tasks without documents.

Seven requests went over the model's window; each was sent again with a smaller view and succeeded. Six views left
evidence out to fit, and each trace records what was cut.

## Cost

The second run made 319 calls, a median of 0.29 seconds each, with 3.2 million input tokens. pi-ai does not receive a
price for Jev from TypeSafe; at the price another provider lists for Jev ($0.042 per million input tokens) the run
would cost about $0.13.

## What this does not show

- Repeat stability for a fixed menu: the two runs differ in code as well as in sampling.
- Accuracy on answers no judge has seen before.
- Whether belief-based stopping, targeted menus or a cascade help; those are the next phase.

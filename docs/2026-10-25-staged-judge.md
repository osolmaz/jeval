---
title: Staged judge for the legal-judge domain
author: Onur Solmaz
date: 2026-10-25
---

# Staged judge for the legal-judge domain

## TL;DR

The legal-judge domain now judges each rubric item in stages instead of with one question. Jev splits the item into
its separate requirements without changing its words, checks the whole item, whether anything is missed and each
part, then decides the item with those checks in view. Every request tells Jev what the whole process is and which
stage it is in. The results of the first runs are at the end.

## Why

A single question per item was lenient on items that list several requirements. When an answer met most of them, or
mentioned the topic of the last one, Jev passed the item. In a probe, a short answer that left one part out was caught
for only about half of the items, and "There is no extension; the archive cannot be extended" passed a requirement to
state "the extension mechanism" with a probability of 0.81.

## The stages

1. **Gather.** As before, Jev picks steps from the menu until the evidence is enough.
2. **Split.** Each rubric item is split once per item text and reused for every answer to the task.
   - Code offers every gap between two words. The item is covered by overlapping windows of 12 gaps, 6 apart, and
     each window is one `choice` question: where inside this stretch does a new, separate requirement start, or
     nowhere? Each gap is quoted with the four words on either side, so Jev never has to find a numbered position.
     All windows of an item go out in one request.
   - Picks of 0.5 or more are kept, and a pick within two words of a stronger one is merged into it.
   - One `bool` question per split item asks whether the split is correct: each part one whole requirement, no
     requirement or shared phrase cut in two, nothing left out. A split is used only when Jev accepts it.
   - The item's wording never changes: a part is the item's own words, shown highlighted between ⟦ and ⟧ inside the
     whole item.
3. **Check.** Over the evidence, for each item: does the answer meet the whole item, does it miss or contradict any
   requirement, and, for an accepted split, does it meet each part?
4. **Decide.** One `bool` question per item lists the stage 3 checks as probabilities and asks for the final
   decision; every requirement must be met unless the item says otherwise.

Each stage is recorded in the trace as an `asked` entry with its answers, so any rule can be scored again from a trace
without new model calls, and a replay repeats every stage.

## What Jev is told

Every request carries `process`, a description of the four stages, and `stage`, what the current stage does. The
check and decide stages also carry `rules`:

- apply each item's PASS and FAIL rules exactly as written, and let equivalent wording pass;
- mentioning a topic is not meeting a requirement about it;
- saying the opposite, or saying that the required thing does not exist, does not meet it;
- what the submitted files do not state does not count;
- check facts, figures and citations against the task's documents.

The splitting stage explains what a separate requirement is (something an answer could meet while missing the
others), what is not (examples, a qualifying detail such as a deadline, words like "however phrased"), and that words
shared by several parts belong with all of them. All texts are in `src/domains/legal-judge/prompts.ts`.

## Core change

A domain may now define `judge`, which receives the gathered state and an `ask` function. `ask` sends questions in
batches that fit the window, over the evidence view or over a fixed state such as one rubric item, adds fields such as
the stage description to the view, records the stage in the trace, and fails the case with a clear error when a stage
fails. Without `judge`, the domain's questions are asked once, as before.

## First results

One grading per answer with `typesafe/jev-latest`, on the 100-answer split of a private judge eval (1,288 items,
labels from strong models and a review) and on 71 Sol answers to finalized tasks of the same project (2,256 items),
whose labels are GPT-6.1 Sol's own verdicts and therefore measure agreement with Sol, not accuracy. Every rule below is
scored from the stage answers of the same staged run.

| Rule                                  | Judge eval, items right                 | Agreement with Sol |
| ------------------------------------- | --------------------------------------- | ------------------ |
| Stage 4 decision (the staged judge)   | 95.2% (33 false passes, 29 false fails) | 83.6% (278, 93)    |
| Whole item only                       | 94.7% (44, 24)                          | 81.6% (350, 65)    |
| Whole item, and nothing missed        | 94.6% (27, 43)                          | 84.6% (215, 133)   |
| Every part, and nothing missed        | 94.4% (27, 45)                          | 84.8% (207, 137)   |
| The single question of the first runs | 94.6% (49, 21)                          | 80.6% (376, 61)    |

- The staged judge's decision is the best rule on the judge eval and 3 points closer to Sol than the single question.
  The simpler rule "whole item, and nothing missed" is one point closer to Sol and 0.6 points lower on the judge eval;
  on the judge eval these differences are within the variation between runs.
- The splits are good: on a synthetic 125-word item the windows found every boundary at the exact word. But a part
  that the answer denies is still often passed. On the item behind the probe, the answer says "There is no automatic
  extension", and Jev passed the part "the extension mechanism" at 0.78 and the item at 0.82, although the rules now
  say that a stated absence does not meet a requirement. Where Jev and Sol disagree, which of them is right is not
  known until people label a sample.
- The staged judge costs about three times the tokens of the single question: 1,759 calls and 9.0 million input tokens
  for the 100 answers, 2,660 calls and 12.3 million for the 71. Most calls split items, one call per item, and an item
  is split only once for all answers to its task.

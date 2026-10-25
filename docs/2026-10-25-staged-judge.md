---
title: Staged judge for the legal-judge domain
author: Onur Solmaz
date: 2026-10-25
---

# Staged judge for the legal-judge domain

## TL;DR

The legal-judge domain judges each rubric item in stages: Jev splits the item into its requirements without changing
its words, points to the sentence of the answer that meets each requirement, checks each pointed sentence on its own
and each whole item, and decides with all the checks in view. Pointing is a new core building block: Jev cannot quote,
but it can choose one branch at a time down a tree of the text. On a labeled judge eval the staged judge gets 94.8% of
1,288 items right and agrees with GPT-6.1 Sol on 83.6% of 2,256 items; the simple rule "meets the whole item and misses
nothing" does as well or slightly better (95.0% and 84.8%), so the stages do not yet earn their cost.

## Why

A single question per item was lenient on items that list several requirements. When an answer met most of them, or
mentioned the topic of the last one, Jev passed the item. In a probe, a short answer that left one part out was caught
for only about half of the items, and "There is no extension; the archive cannot be extended" passed a requirement to
state "the extension mechanism" with a probability of 0.81. Shown that sentence alone, with the requirement, Jev
judged it correctly (0.03), as it did five other single sentences; that is what pointing is for.

## Pointing

The core gains `locate` and `locateAll` (`src/core/locate.ts`).

- Code shows text as a tree of `Node`s, whose children are built only when a search reaches them.
- `locate` runs many searches level by level. At each level a search asks one `choice` question: which child is, or
  leads to, the place the question asks for, or none. A level longer than 12 options is shown in overlapping windows
  and the strongest pick wins. A level with one option needs no question. Candidates, such as search hits, can be
  offered first, with the option to look through the whole tree instead. All searches that are still going share one
  request per level, so the number of requests is the depth of the deepest search, not the number of searches.
- `locateAll` marks every place in a flat level: each window can mark one, picks of 0.5 or more count, and a pick
  within two positions of a stronger one is merged into it.
- The path a search took is its citation; a search that ends on none found no place.

## The stages

1. **Gather.** Jev picks steps from the menu until the evidence is enough.
2. **Split.** `locateAll` over each item's word gaps, each gap quoted with the four words on either side; then one
   `bool` question per split item confirms it. Items are split once per text and reused for every answer to the task.
   The item's words never change: a part is shown highlighted between ⟦ and ⟧ inside the whole item.
3. **Point.** For each requirement (a part of an accepted split, or the whole item), `locate` searches the answer's
   tree (files, sections at its headings, paragraphs, sentences), starting from the ten sentences that share the most
   key words with the requirement.
4. **Check.** Each pointed sentence is judged on its own, with its paragraph: does it, as written, meet the
   requirement? Each whole item is checked over the evidence: does the answer meet it, and does it miss or contradict
   any requirement?
5. **Decide.** One `bool` question per item lists the checks as probabilities and asks for the final decision.

Each request carries `process`, a description of the five stages, and `stage`, what the current stage does; the
check and decide stages also carry `rules` (apply PASS and FAIL rules as written; a mention, a denial or a stated
absence does not meet a requirement; check facts against the task's documents). All texts are in
`src/domains/legal-judge/prompts.ts`. Each stage is recorded in the trace, so any rule can be scored again from a trace.

## Results

One grading per answer with `typesafe/jev-latest`: the 100-answer split of a private judge eval (1,288 items, labels
from strong models and a review), and 71 Sol answers to finalized tasks of the same project (2,256 items) whose labels
are Sol's own verdicts, which measure agreement with Sol, not accuracy. Every rule is scored from the same run.

| Rule                                                           | Judge eval, items right                 | Agreement with Sol |
| -------------------------------------------------------------- | --------------------------------------- | ------------------ |
| Stage 5 decision (the staged judge)                            | 94.8% (34 false passes, 33 false fails) | 83.6% (264, 107)   |
| Meets the whole item                                           | 94.8% (47, 20)                          | 81.4% (353, 66)    |
| Meets the whole item and misses nothing                        | 95.0% (24, 41)                          | 84.8% (213, 131)   |
| Every requirement pointed to and met                           | 81.8% (28, 206)                         | 72.7% (169, 447)   |
| Earlier version: parts judged inside the whole state, decision | 95.2% (33, 29)                          | 83.6% (278, 93)    |
| The single question of the first runs                          | 94.6% (49, 21)                          | 80.6% (376, 61)    |

- The staged decision, the earlier staged version and the simple rule "meets and misses nothing" are within a point of
  each other on both sets. The simple rule is the cheapest of them.
- Requiring a pointed sentence for every requirement fails far too many good answers. Many requirements are not one
  sentence: that the output is a single clause, a word limit, that something is absent, or a duty spread across a
  paragraph. A single pointed sentence cannot show those.
- On the item behind the probe the decision fell from 0.82 to 0.54, still a pass: one part's pointed sentence was
  judged not to meet it (0.20), and for the extension mechanism no sentence was found, which the decision weighed
  lightly.
- A run took 972 calls and 11.1 million input tokens for the 100 answers, and 884 calls and 13.5 million for the 71:
  half the calls of the earlier staged version, because all searches of a case share each request.
- Where Jev and Sol disagree, which of them is right is not known until people label a sample.

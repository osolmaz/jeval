---
title: Meets and misses for the legal-judge domain
author: Onur Solmaz
date: 2026-10-26
---

# Meets and misses for the legal-judge domain

## TL;DR

The legal-judge domain now asks Jev two questions per rubric item, whether the answer meets the item and whether it
misses or contradicts any of its requirements, and passes the item only when it meets it and misses nothing. That rule
got 94.6% of 1,288 labeled items right and agreed with GPT-6.1 Sol on 84.1% of 2,256 items, against 94.6% and 80.6%
for one question per item. Two staged judges, one that splits items into parts and one that also points to the
sentence of the answer that meets each part, did no better on either set at two to four times the cost, so they were
not adopted.

## The rule

After gathering evidence, one request per batch asks, for every item:

- **Meets:** does the submitted answer meet this item?
- **Misses:** checking each requirement and each FAIL rule separately, does the answer miss or contradict at least
  one of them?

The item's probability is the smaller of P(meets) and 1 − P(misses), so it is 0.5 or more exactly when Jev says the
answer meets the item and says nothing is missed. Both answers are kept in the trace as the `check` stage.

Every request tells Jev the process (gather, then check) and its stage, and the check carries rules: apply the PASS
and FAIL rules as written; a mention, a denial or a stated absence does not meet a requirement; check facts, figures and
citations against the task's documents. The texts are in `src/domains/legal-judge/prompts.ts`.

## Why two questions

One question per item was lenient on items that list several requirements: when an answer met most of them, Jev
passed the item. Asked directly whether something is missing, Jev often notices the gap. On the Sol set the second
question cut the items Jev passed and Sol failed from 376 to 234; on the labeled set the false passes fell from 49 to
29 and the false fails rose from 21 to 41, with the same accuracy.

## What was tried and not adopted

All on the same answers: the 100-answer split of a private judge eval with labels from strong models and a review, and
71 Sol answers to finalized tasks of the same project, whose labels are Sol's own verdicts and measure agreement with
Sol, not accuracy.

| Judge                                                          | Judge eval, items right | Agreement with Sol | Calls, tokens (100 answers) |
| -------------------------------------------------------------- | ----------------------- | ------------------ | --------------------------- |
| One question per item                                          | 94.6%                   | 80.6%              | 319, 3.2 M                  |
| **Meets and misses (adopted)**                                 | **94.6%**               | **84.1%**          | 333, 3.4 M                  |
| Staged: split into parts, check each, decide                   | 95.2%                   | 83.6%              | 1,759, 9.0 M                |
| Staged with pointing to evidence, decide                       | 94.8%                   | 83.6%              | 972, 11.1 M                 |
| Pointing as a gate: every requirement needs a pointed sentence | 81.8%                   | 72.7%              | as above                    |

- **Splitting** (osolmaz/jeval#2) found requirement boundaries well with overlapping windows of word gaps, but checking
  each part added little over the two questions.
- **Pointing** (osolmaz/jeval#4) let Jev choose one branch at a time down a tree of the answer to the sentence that
  meets a requirement. Shown a single sentence, Jev judged six of six correctly, including "There is no automatic
  extension." against "the extension mechanism" (0.07), which it passes at 0.8 inside a whole answer. But many
  requirements are not one sentence, such as a word limit, that the output is a single clause, or that something is
  absent, so requiring a pointed sentence failed many good answers, and as one input to a final decision it changed
  little.

The differences between the two staged judges and meets-and-misses are within a point on both sets, so the cheapest
won. Both branches stay in their closed pull requests.

## Other question framings, also not adopted

Asked over the evidence of the adopted run, one grading per answer, and scored against the same labels:

| Rule                                                                            | Judge eval, items right | Agreement with Sol |
| ------------------------------------------------------------------------------- | ----------------------- | ------------------ |
| Meets and misses (adopted, this run)                                            | 94.6%                   | 84.4%              |
| "How many requirements are met: none, some, most, all", passing at most or more | 95.2%                   | 81.6%              |
| The same, passing only at all                                                   | 91.9%                   | 83.8%              |
| "Is the requirement the answer covers least fully met?"                         | 94.6%                   | 83.3%              |
| Meets and misses, and the weakest requirement met                               | 94.5%                   | 84.4%              |
| Meets and misses, and no denial of a required thing                             | 91.1%                   | 80.8%              |

A rule about qualifiers was also added to the check's rules: "Most items turn on a condition, marked by words such as
'despite', 'without', 'only', 'unless', 'even if', 'subject only to', 'at least' or 'within'. The answer meets the item
only when it satisfies that condition as written, not just the item's topic. An answer that covers the topic but adds a
condition the item excludes, or leaves out a condition the item requires, does not meet the item." With meets and
misses over the same evidence it got 94.6% of the judge eval right (23 false passes, 46 false fails, against 26 and 44) and agreed with Sol on 85.1% (against 84.4%). It moves toward Sol by less than a point and leaves the judge eval as it
was, so it waits for people's labels of the disagreements, which can tell whether moving toward Sol is moving toward
correct.

None is better on both sets. A question about denials catches the item behind the probe (0.57), but as a veto it fails
many good answers, which often state exclusions on purpose.

## Reading more, also not adopted

With the menu, Jev usually reads the answer, opens one document and stops: it opened 37% of the documents in the
judge eval and 28% in the Sol set. Two variants made it read more (branch `exp/read-more`):

- **Open every file first:** stop is not offered while the menu can still open a file that no step has opened. Jev
  then opened 76% and 59% of the documents, in 3 to 4 steps on average.
- **Preload:** every document is read before the first choice, up to 30,000 estimated tokens.

On the cases that all three finished (88 and 67 answers):

| Rule                         | Judge eval, items right | Agreement with Sol |
| ---------------------------- | ----------------------- | ------------------ |
| Meets and misses, menu as is | 94.9%                   | 84.0%              |
| Open every file first        | 94.8%                   | 84.3%              |
| Preload                      | 95.1%                   | 84.5%              |

The differences are within a point, so reading more is not what the judge lacks; the disagreements are about the
answer's own text. Preloading also failed 12 judge-eval cases on Jev's window, because three characters a token
undercounts some documents, and 4 Sol-set cases on images whose dimensions Jev rejects. The `look` action could send
the same images; ingest now scales every image so that no side is longer than 1,568 pixels, the most Jev accepts.

## Open

- **Who is right where Jev and Sol disagree.** 234 items still pass with Jev and fail with Sol. Some may be Sol's
  strictness on hardened rubrics; only people labeling a sample can tell.
- **Denials inside long answers.** On the item behind the probe Jev still says "meets" at 0.87 and "misses" at 0.31.

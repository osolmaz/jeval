# Rubric judge

The rubric-judge example is a harness on switch with one domain, `rubric-judge`. It grades a saved answer to a task
against the task's rubric. The model reads the answer and gathers what it needs from the task's documents one step at
a time. Then it answers two questions per rubric item: whether the answer meets it, and whether it misses or
contradicts any requirement. An item passes when both checks pass.

The texts that tell the model what the task is and how to judge it are in a judge file, with the questions and the
limits. The judge file is this domain's definition, so a variant of the judge is another file passed with `--judge`.
The texts of the steps, such as each choice's text, are in the code, and come with the domain's version. Three judge
files come with the example:

- [`judges/general.json`](judges/general.json), the default, names no field of work.
- [`judges/legal.json`](judges/legal.json) is the same judge for legal tasks. Its texts are those of the judge that
  this example had when it graded legal tasks only, so its scores compare with that judge's.
- [`judges/legal-qualifiers.json`](judges/legal-qualifiers.json) adds a rule on the conditions that most legal rubric
  items turn on, such as "despite" or "unless".

All labelled cases so far are legal tasks, so a score of the general judge says how it does on legal tasks only.

The example uses switch only by its package name, `@osolmaz/switch`, as a project outside switch would. Its program
adds the [viewer](../../viewer/README.md)'s `view` and three commands of its own to switch's `run` and `replay`:
`ingest`, `score` and `compare`. The domain brings its own flag, `--judge <file>`, which `run` and `replay` take.

## Install

`pnpm install` at the repository root installs switch and this example, as the [main README](../../README.md#install)
says. `ingest` also calls three programs, which must be on the `PATH`. It calls each one only for the files that need
it:

- Poppler's `pdftoppm` renders PDF pages that have no text layer, such as scans, as images.
- LibreOffice's `soffice` reads old Word `.doc` files.
- Netpbm decodes and scales images with `pngtopnm`, `jpegtopnm`, `giftopnm`, `pamscale` and `pnmtopng`.

On Debian or Ubuntu:

```bash
sudo apt install poppler-utils libreoffice-writer netpbm
```

`run` and the other commands read case folders that `ingest` already made, so they need none of these programs.

## The state machine

Each case is a state machine, in `src/index.ts`:

- The state is the evidence found so far, in order. Each entry has the key of the choice that found it, its source,
  its text, and, for a look at an image, the image's file next to the case.
- The initial state holds the answer's files, read before the first pick: their text up to a budget, their images and
  their Word formatting.
- The choice function joins six types of choice, each in a file of its own in [`src/choices/`](src/choices): read a
  file or a part of it, look at an image, search a term from the rubric, count the answer's words, list a document's
  tracked changes, and compare the answer's Word file with the original. Each type leaves out what the evidence
  already holds.
- The transition function adds the evidence of the picked choice.
- The view function shows the request, the rubric, the files and what has been read of them, and the evidence, cut to fit the
  window. It loads the images that the evidence names from the case folder.
- The answer stage asks the judge's two questions about every rubric item over the evidence, and combines them into
  one verdict per item.

The case, its search terms and its folder stay inside these functions.

## Grade cases

A case starts as an input folder that holds the request in `request.md` and the rubric in `rubric.json`
(`{"items": [{"id", "category", "text"}]}`), with the task's files under `documents/` and the answer's files under
`answer/`. `ingest` turns it into a case folder, which records each file's `format`, and `run` grades case folders with
a pi-ai classifier model. pi-ai finds the provider's key, for example `TYPESAFE_API_KEY` for `typesafe/jev-latest`, or
`--api-key-env` names the variable that holds it. The program is
[`src/main.ts`](src/main.ts). Run the commands from the repository root:

```bash
examples/rubric-judge/src/main.ts ingest input/case-1 cases/case-1
examples/rubric-judge/src/main.ts run cases/case-1 --out results --model typesafe/jev-latest
```

A run writes one folder. `run.json` records what ran, including the judge file as the run's definition, its hash and
the switch commit, and at the end the totals, with the cost. Each case keeps its answers and a trace of every state,
and `requests.jsonl` keeps every decision request that switch passed to pi-ai, with each image by its label, and its
result. A stopped run goes on in the same folder; a judge file with another hash needs another folder.

## Measure a judge

To measure a judge, an eval set file names the case folders and the scheduled case ids. It also points to a labels
file in JSON Lines (`{"id", "items": [{"id", "pass"}]}`). `score` checks a run against the set's labels, overall and
by each rubric item's category. `run --state-from <run>` asks another judge file or model over the evidence that an
earlier run gathered, for about a third of the cost of a new run. It takes the earlier run's states from its traces.
Of each case folder, it reads `case.json`, as every command does, and the images that the evidence names.
`compare` then scores runs side by side on the cases that all of them answered:

```bash
examples/rubric-judge/src/main.ts run --set sets/quick.json --out results
examples/rubric-judge/src/main.ts run --set sets/quick.json --state-from results --out results-legal --judge examples/rubric-judge/judges/legal.json
examples/rubric-judge/src/main.ts compare results results-legal --set sets/quick.json
```

## Verdicts

The judge asks two bool questions about each rubric item: whether the answer meets the item, with probability $a$,
and whether it misses or contradicts any requirement, with probability $b$.
[Meets and misses](../../docs/2026-10-26-meets-and-misses.md) explains why it asks two. The item passes when it meets
the item and misses nothing, and `combine` in [`src/judge.ts`](src/judge.ts) gives that the probability

$$P(\text{pass}) = \min(a,\; 1 - b)$$

The model gives each of the two probabilities on its own, and says nothing about how the two relate. For any two
events, the probability that both are true is at most the smaller of their probabilities:

$$P(A \cap B) \le \min\big(P(A), P(B)\big)$$

The two sides are equal when the two checks agree as much as they can, so the minimum is the largest probability that
fits both answers. The product $a(1 - b)$ would assume that the two checks are independent, and they are not: both
read the same evidence about the same answer.

The verdict is pass when $P(\text{pass}) \ge 0.5$. With the minimum, that holds exactly when $a \ge 0.5$ and
$b \le 0.5$: the model says the answer meets the item, and says nothing is missed.

## Scores against labels

`score` in [`src/score/score.ts`](src/score/score.ts) compares the verdicts with reference labels. It counts the items
in four groups, by the judge's verdict and the label: $tp$ (both pass), $fp$ (the judge passes, the label fails),
$fn$ (the judge fails, the label passes) and $tn$ (both fail), with $n$ items in all. From these:

$$\text{accuracy} = \frac{tp + tn}{n}, \qquad \text{balanced accuracy} = \frac{1}{2}\left(\frac{tp}{tp + fn} + \frac{tn}{tn + fp}\right)$$

Accuracy alone can look good for a judge that passes everything, when most items pass. Cohen's kappa corrects for
this. It compares the accuracy with $p_e$, the accuracy that a judge would get by chance if it passed the same share
of items but at random:

$$p_e = \frac{(tp + fp)(tp + fn) + (fn + tn)(fp + tn)}{n^2}, \qquad \kappa = \frac{\text{accuracy} - p_e}{1 - p_e}$$

A kappa of 1 is full agreement and 0 is no better than chance. When 90% of the items pass, a judge that passes every
item has an accuracy of 0.9 and a kappa of 0.

The report adds three more numbers:

- Items right over all scheduled items, where every item of a case without answers counts as wrong.
- Whole answers right: the judge's verdict on an answer is pass when every item passes, compared with the same for
  the labels.
- Accuracy by each rubric item's category, which `score` reads from the case folders.

## Replay a case

`replay` runs a case again from its trace, with the judge file that `--judge` names, or the default judge. Give it the
judge file that the run used, which the run's `run.json` records as its definition; the replay's trace notes it when
the hashes differ. With `--fork <steps>` it takes the
state after that many recorded steps and lets the model go on from there. The
[main README](../../README.md#replay-a-case) says how a replay repeats a case.

## Check

`pnpm check` in this folder runs the example's own format, lint, typecheck, tests with the 85% coverage gate and DRY
scan. `pnpm check` at the repository root runs it too.

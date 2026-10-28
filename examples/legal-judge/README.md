# Legal judge

The legal-judge example is a harness on switch with one domain, `legal-judge`. It grades a saved answer to a legal
task against the task's rubric. The model reads the answer and gathers what it needs from the task's documents one
step at a time. Then it answers two questions per rubric item: whether the answer meets it, and whether it misses or
contradicts any requirement. An item passes when both checks pass. Every text the model reads is in a judge file,
[`judges/legal-judge.json`](judges/legal-judge.json). The judge file is this domain's definition, so a variant of the
judge is another file passed with `--definition`.

The example uses switch only by its package name, `@osolmaz/switch`, as a project outside switch would. Its program
adds three commands to switch's `run`, `replay` and `view`: `ingest`, `score` and `compare`.

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
- The view shows the request, the rubric, the files and what has been read of them, and the evidence, cut to fit the
  window. It loads the images that the evidence names from the case folder.
- The answer stage asks the judge's two questions about every rubric item over the evidence, and combines them into
  one verdict per item.

The case, its search terms and its folder stay inside these functions.

## Grade cases

A case starts as an input folder that holds the request in `request.md` and the rubric in `rubric.json`
(`{"items": [{"id", "category", "text"}]}`), with the task's files under `documents/` and the answer's files under
`answer/`. `ingest` turns it into a case folder, and `run` grades case folders with a pi-ai classifier model whose key
it reads from `PROVIDER_API_KEY`, for example `TYPESAFE_API_KEY` for `typesafe/jev-latest`. The program is
[`src/main.ts`](src/main.ts). Run the commands from the repository root:

```bash
examples/legal-judge/src/main.ts ingest input/case-1 cases/case-1
examples/legal-judge/src/main.ts run cases/case-1 --out results --model typesafe/jev-latest
```

A run writes one folder. `run.json` records what ran, including the judge file as the run's definition, its hash and
the switch commit. Each case keeps its answers and a trace of every state, and `requests.jsonl` keeps every request
exactly as the model received it. A stopped run goes on in the same folder.

## Measure a judge

To measure a judge, an eval set file names the case folders and the scheduled case ids. It also points to a labels
file in JSON Lines (`{"id", "items": [{"id", "pass"}]}`). `score` checks a run against the set's labels, overall and
by each rubric item's category. `run --state-from <run>` asks another judge file or model over the evidence that an
earlier run gathered, for about a third of the cost of a new run. It takes the earlier run's states from its traces
and reads no case file again, except the images that the evidence names. `compare` then scores runs side by side on
the cases that all of them answered:

```bash
examples/legal-judge/src/main.ts run --set sets/quick.json --out results
examples/legal-judge/src/main.ts run --set sets/quick.json --state-from results --out results-strict --definition judges/strict.json
examples/legal-judge/src/main.ts compare results results-strict --set sets/quick.json
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

`replay` runs a case again from its trace, with the judge file that the trace was made with, and with `--fork <steps>`
it takes the state after that many recorded steps and lets the model go on from there. The
[main README](../../README.md#replay-a-case) says how a replay repeats a case.

## Traces from before states

A trace written before switch saved states has `observation` entries in place of `state` entries, and the newer code
does not read it. This command turns one into states, with the case's `case.json`, which names the file of each image
that the trace looked at. It writes a new file, and you replace the old one after a check. A trace from before switch's
PR #26 first needs that PR's renames, which [the plan](../../docs/2026-10-28-domains-as-examples.md#migrations) lists
with the `run.json` change.

```bash
jq -s -c --slurpfile case cases/case-1/case.json '
  def image($seen):
    if ($seen.images | length) == 0 then {}
    else ($seen.key | capture("^look:(?<file>.+):(?<index>[0-9]+)$")) as $look
      | {image: ($case[0].files[] | select(.id == $look.file) | .renders[$look.index | tonumber])}
    end;
  def next($before; $seen):
    {evidence: (($before.evidence // []) + [{key: $seen.key, source: $seen.source, text: $seen.text} + image($seen)])};
  def flush: if .open == null then . else .out += [{type: "state", step: .open, state: .state}] | .open = null end;
  def entry($e):
    if $e.type == "case" then {type: "start", domain: $e.domain, version: $e.version, model: $e.model, limits: $e.limits}
    elif $e.type == "menu" then
      {type: "choices", step: $e.step, choices: [$e.choices[] | {key, type: .kind, text} + (if .data == null then {} else {data} end)]}
    elif $e.type == "choice" then $e | del(.id, .parent) | .type = "pick"
    elif $e.type == "asked" then (if $e.stage == "answers" then empty else $e | del(.id, .parent) | .type = "stage" end)
    else $e | del(.id, .parent) end;
  reduce .[] as $e ({out: [], state: null, open: null};
    if $e.type == "observation" then .state = next(.state; $e) | .open = $e.step else flush | .out += [entry($e)] end)
  | flush | .out | to_entries[] | .value + {id: .key, parent: (if .key == 0 then null else .key - 1 end)}
' results/cases/case-1/trace.jsonl > trace.states.jsonl
```

No legal-judge run was at hand, so the command was tried on a trace that the code before this change wrote for a test
case with an answer image and a scanned page. Converted, it is the same as the trace that the code now writes for that
case, except for the domain's version.

## Check

`pnpm check` in this folder runs the example's own format, lint, typecheck, tests with the 85% coverage gate and DRY
scan. `pnpm check` at the repository root runs it too.

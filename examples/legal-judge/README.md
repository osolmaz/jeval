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
the switch commit. Each case keeps its answers and a trace of every step, and `requests.jsonl` keeps every request
exactly as the model received it. A stopped run goes on in the same folder.

## Measure a judge

To measure a judge, an eval set file names the case folders and the scheduled case ids. It also points to a labels
file in JSON Lines (`{"id", "items": [{"id", "pass"}]}`). `score` checks a run against the set's labels, overall and
by each rubric item's category. `run --steps-from <run>` asks another judge file or model over the evidence that an
earlier run gathered, for about a third of the cost of a new run. It repeats the earlier run's steps from its traces
and reads no case file again, except the images the model looked at. `compare` then scores runs side by side on the
cases that all of them answered:

```bash
examples/legal-judge/src/main.ts run --set sets/quick.json --out results
examples/legal-judge/src/main.ts run --set sets/quick.json --steps-from results --out results-strict --definition judges/strict.json
examples/legal-judge/src/main.ts compare results results-strict --set sets/quick.json
```

## Replay a case

`replay` runs a case again from its trace, with the judge file that the trace was made with, and with `--fork <steps>`
it repeats that many recorded steps and lets the model go on from there. The
[main README](../../README.md#replay-a-case) says how a replay repeats a case.

## Check

`pnpm check` in this folder runs the example's own format, lint, typecheck, tests with the 85% coverage gate and DRY
scan. `pnpm check` at the repository root runs it too.

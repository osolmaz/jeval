# jeval

jeval is a harness for decision models, such as TypeSafe's Jev, that lets them work through multi-step tasks. At
each step, code lists the steps that are allowed, the model picks one, and code runs it, until the model can answer
typed questions about the case.

Grading an answer against a rubric is the first use, as the `legal-judge` domain: the model reads the answer, chooses
which documents to read, which terms to search and what to compare, then answers one yes-or-no question per rubric
item. The same loop can route a request, sort a report or decide whether a case needs a person.

## Install

jeval needs Node.js 22.13 or newer and pnpm. Ingesting PDF scans, legacy Word files and PPM images also needs
`pdftoppm` (Poppler), `soffice` (LibreOffice) and `pnmtopng` (Netpbm).

```bash
git clone https://github.com/osolmaz/jeval
cd jeval
pnpm install
```

## Use

A case starts as an input folder with `request.md`, `rubric.json` (`{"items": [{"id", "category", "text"}]}`), the
task's files under `documents/` and the answer's files under `answer/`. `ingest` turns it into a case folder:

```bash
node src/cli/main.ts ingest input/case-1 cases/case-1
```

`run` grades case folders with a classifier model that pi-ai lists, and reads its API key from `PROVIDER_API_KEY`,
for example `TYPESAFE_API_KEY` for `typesafe/jev-latest`. It writes one run folder:

```text
results/
  run.json               what ran: domain and version, model, limits, jeval version and commit, times, totals
  cases/<id>/
    result.json          the case's answers, or its error
    trace.jsonl          every menu, choice, observation and answer, in order
    requests.jsonl       every request sent to the model, as sent, with its answers and usage
```

```bash
node src/cli/main.ts run cases/* --out results --model typesafe/jev-latest
```

A stopped run goes on in the same folder and skips the cases that are done; a folder that holds a run of another
domain, model, limits or commit is refused. `replay` runs a case again from its trace; with `--fork <steps>`, it
repeats that many recorded steps and lets the model go on from there. `score` compares a run with reference labels in
JSON Lines (`{"id", "items": [{"id", "pass"}]}`):

```bash
node src/cli/main.ts replay cases/case-1 results/cases/case-1/trace.jsonl
node src/cli/main.ts score results --labels labels.jsonl
```

## Write a domain

A domain declares actions, questions and a view; the core runs the loop. An action lists the options that make sense
in the current state and says what each one finds:

```ts
export const search = action<Workspace, Term>({
  name: "search",
  options: (state) =>
    state.workspace.terms.map((term) => ({
      key: term.term,
      text: `Find the passages that mention “${term.term}”`,
      arg: term,
    })),
  observe: (workspace, term) => ({ source: `search for “${term.term}”`, text: workspace.search(term.term) }),
});
```

The `legal-judge` domain in `src/domains/legal-judge/` is the complete example. The design is in
[docs/2026-10-25-jeval-plan.md](docs/2026-10-25-jeval-plan.md).

## License

[MIT](LICENSE)

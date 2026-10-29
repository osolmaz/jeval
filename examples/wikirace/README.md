# WikiRace

The wikirace example is a harness on switch with one domain, `wikirace`. The model races through Wikipedia: it starts
at one article and must reach a target article by following only the links on the pages it visits. This is the demo
with which TypeSafe [introduced Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev): a page can have
hundreds or thousands of links, and a decision model picks one of the links that are there, so it never follows a link
that does not exist.

The example uses switch only by its package name, `@osolmaz/switch`, as a project outside switch would.

## Install

`pnpm install` at the repository root installs switch and this example, as the [main README](../../README.md#install)
says. The example reads English Wikipedia through its public API, so a run needs the network. A replay reads no page:
it takes every page's links from the trace.

## Cases

A case folder holds a `case.json` with the case's `id` and the titles of the `start` and `target` articles. Redirects
count: a target of `Manipuri Pony` is reached at the article `Manipuri pony`. The three cases in [`cases/`](cases) are
races from TypeSafe's demo and its launch:

| Case                   | Start       | Target        |
| ---------------------- | ----------- | ------------- |
| `baseball-to-sun`      | Baseball    | Sun           |
| `dna-to-manipuri-pony` | DNA         | Manipuri Pony |
| `rubber-duck-to-moon`  | Rubber duck | Moon          |

## The state machine

Each race is a state machine, in [`src/race.ts`](src/race.ts):

- The state holds the target, the articles visited so far, each with the text of the link that led to it, and the
  current article's links by section. Wikipedia changes, so the state keeps the links as the race saw them.
- The initial state is the start article. The load of the case also reads the target's first sentences, which every
  view shows.
- Until the race is over, the question function asks one pick. Its choice function gives the links of the current
  article in the order of the article, without the links to articles visited before, and giving up, which a cut never
  leaves out. An article with more than 200 links shows the links of its lead and its other sections, and a section
  opens to its links; TypeSafe's demo also splits such pages in two steps, since Jev takes at most 255 answers in one
  question. At the target, or after giving up, the question function asks nothing, so the race ends.
- The transition function follows the picked link and reads the article it leads to, after redirects, opens the
  picked section, or gives up the race.
- The view shows the target and what it is about, the current article, the path so far, what the step shows and what
  the last step did. The links themselves are the pick's choices.

A race's outcome is `reached`, `gave up` or `unfinished`, with the number of hops between articles and the path. A
race that the step limit or a failed request cut is unfinished.

[`src/wiki.ts`](src/wiki.ts) reads an article's HTML from the API and keeps the links to other articles, grouped by
the top-level sections. It leaves out files, categories, help pages and the like, the pages that only list the
articles of one name, and the sections that list sources, such as "References" and "External links".

## Run a race

```bash
examples/wikirace/src/main.ts run examples/wikirace/cases/dna-to-manipuri-pony --out runs/wikirace --model typesafe/jev-latest
```

pi-ai finds the key in `TYPESAFE_API_KEY`, or `--api-key-env` names the variable that holds it. In a test run, Jev
went from DNA to Manipuri pony in 6 hops (DNA, Animal, Equestrianism, Horse, Pony, List of horse breeds) and from
Rubber duck to Moon in 3 (NASA, Solar System). It gave up the race from Baseball to Sun after 4 hops, at Human body,
whose links lead nowhere near the Sun. Each request held about 2,000 to 4,000 input tokens.

`replay` runs a race again from its trace, without the network:

```bash
examples/wikirace/src/main.ts replay examples/wikirace/cases/dna-to-manipuri-pony runs/wikirace/cases/dna-to-manipuri-pony/trace.jsonl
```

## Watch a race

The harness has the `view` command of switch's [viewer](../../viewer/README.md):

```bash
examples/wikirace/src/main.ts view runs/wikirace
```

The wikirace part of the page, in [`src/web/`](src/web), draws each step's trail of articles from the start, the
current one lit, toward the target, and says which section the step showed. The viewer shows the step's choices with
the model's probability for each link.

## Check

`pnpm check` in this folder runs the example's own format, lint, typecheck, tests with the 85% coverage gate and DRY
scan. The tests use a small fake wiki and the fake decider, so they need neither the network nor a model.

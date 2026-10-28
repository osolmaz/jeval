# AGENTS.md

- Read the README's "How it works", [docs/MATH.md](docs/MATH.md) and
  [docs/DECISION_MODEL_API.md](docs/DECISION_MODEL_API.md) before you change the design. The dated docs in `docs/` are
  plans and reports of their day; the latest plan is
  [docs/2026-10-28-domains-as-examples.md](docs/2026-10-28-domains-as-examples.md).
- Run `pnpm check` before you finish: format, lint, typecheck, tests with the 85% coverage gate, the DRY scan, the
  same checks in the viewer and each example, and `slophammer-ts check .`. CI does not run mutation tests; `pnpm mutate` runs them
  locally on request.
- Add or update a test for every behavior change. Tests make no model calls: use the fake decider from
  `@osolmaz/switch/testing`.
- Never commit task data: requests, rubrics, documents, answers, case folders, run results, traces or labels. They
  are proprietary. Tests build their own small fixtures in code.

## Terms

- Use the terms of switch, as the README's "How it works" defines them, in code and docs: state, initial state, choice
  function, choice, pick, transition function, step, view function, view, instructions, question, answer, trace and
  type. A case is a state machine: an initial state, a choice function from the latest state to its choices, and a
  transition function from the state and the picked choice to the next state. The view function turns a state into the
  view, what the model reads. "State" means only that state; the JSON that the model reads is the view's
  `decisionState`.
- Do not use their old names: world, history, observation, menu, kind, workspace, log, entry for a step, option and
  action. Use judge only inside legal-judge, for its own judge files. "Entry" still means one line of a trace, and
  "options" still means a settings object, such as `RunOptions`.

## Code

- TypeScript strict, with only erasable syntax: no `enum`, `namespace` or parameter properties. Import with `.ts`
  extensions; no dynamic `import()`.
- No `any`. Data from outside the process (files, model answers, traces) is `unknown` until a zod schema checks it.
- Keep functions under the lint limits: complexity 8 and 80 lines. Split them by responsibility; do not raise a limit.
- A suppression comment needs a reason after `--`.

## Only the interface in switch

- switch is the interface between a domain and a decision model, and nothing more: the types of a domain and its state
  machine, the loop, the choice checks, the trace, replay, the model glue in `src/models`, the command line that runs
  cases, and the fake decider for tests.
- switch has no user interface. `src/` has no web page, HTTP server, styles or browser code. The web viewer is a
  package of its own in `viewer/`, which uses switch as the examples do.
- What goes to a decision model and comes back follows pi-ai's classifier interface, as far as switch can use it: the
  decision request, the questions, the answers, the decision result and its usage. A field that carries pi-ai's content
  takes the prefix `decision`, such as `decisionState`. switch reshapes pi-ai's data only where it must, and says why in
  the code: a result's `tooLong` and `milliseconds`, an image's label, and the pick's short labels.

## No domain in switch

- switch knows nothing about any domain. `src/`, the trace, `viewer/` and its page have no domain's words, fields, file
  formats, styles or special cases. This also holds for their comments, help texts and examples.
- A domain brings what it needs through switch's general parts: its state, its choice function, its transition
  function, its view function and its questions. For the viewer, it may give its own part of the page, which draws its
  states, its own controls and its own styles.
- A concept goes into switch or the viewer only when it means the same thing for any domain.
- A domain must give an initial state, a choice function and a transition function. The view function, the questions,
  the answer stages and the outcome are optional. Behind these functions, a domain may use any library, program or data
  of its own, and switch never sees it.

## Boundaries

`slophammer.yml` enforces these:

- `src/` is switch, and imports no domain. `src/core` imports nothing else from `src`. It holds the building blocks, the
  loop, the choice checks, the trace, replay and the domain type that runs a domain on case folders.
- `src/models` and `src/testing` import only `src/core`.
- `src/cli` wires the others together into `commandLine`, the program of a harness with `run` and `replay`, which takes
  the harness's domains by name.
- `viewer/` turns a run folder into a web page that shows any domain's run, and gives a harness the `view` command. A
  domain may give its own part of the page, such as the chess board: browser modules that register hooks with
  `registerPart`, and a `DomainViewer` that names them and their stylesheets. A part's hooks draw a domain's own
  things; a hook goes into the viewer only when any domain could use it.
- The page joins the viewer's browser modules in `viewer/src/web/` and then each part's modules into one script. They
  import each other with plain relative `import { … } from "…/name.ts"` lines and the viewer's page with
  `import { … } from "@osolmaz/switch-viewer/page"`, which the script drops. They take only types from other code, and
  keep their top-level names unique across the whole script.
- The viewer and each harness in `examples/` are packages of their own, with their own lint, typecheck, test and
  coverage settings. They import switch only by the package's name and entry points, such as `@osolmaz/switch/cli`,
  never by a path out of their folder. In this repository the `switch-source` condition points those names at
  switch's TypeScript sources: `tsconfig.json`, the Vitest configs and each example's `src/main.ts` shebang set it.
- A domain's choice function reads only the state and the case's fixed data. In a run, only `load`, the initial state,
  the transition and the view function's reads of the case's own files read files or start programs. The rest of the
  file and process work stays in the domain's setup and harness: its `ingest/` folder, `load.ts`, `setup.ts`,
  `viewer.ts`, the reading of its definition file, and its own commands, such as legal-judge's scoring. A state
  machine may hold a handle to a program outside, such as the chess engine that `load.ts` starts: a replay takes each
  recorded state and runs no transition again.
- Each domain's `setup.ts` exports the function that sets the domain up: it loads case folders and reports a case. A
  domain that needs input from the command line, such as legal-judge's judge file, declares its own `flags` in its
  `DomainSetup`, and `setup` gets their values. switch's commands have no flag of any one domain. The example's
  `src/main.ts` passes the domain to `commandLine`, and adds the viewer's `viewCommand`.
- Each example lists its own words in `domain-words.txt`, one a line. `tests/no-domain.test.ts` reads every example's
  list and fails when `src/` or `viewer/src` uses one of the words, or when an example has no list. A new example
  brings its list.

## Dependencies and docs

- Pin every dependency to an exact version and commit `pnpm-lock.yaml`. Add a dependency only when Node and the
  existing ones cannot do the job.
- Write the project's name in lowercase, switch, also at the start of a sentence and in headings.
- Follow [SimpleDoc](https://github.com/osolmaz/SimpleDoc) for Markdown files: a doc tied to a date goes in `docs/`
  as `YYYY-MM-DD-lowercase-title.md` with `title`, `author` and `date` frontmatter.
- Write commit messages and pull request titles as Conventional Commits. Add `[skip ci]` to documentation-only
  commits.
- Do not put coding-agent branding, such as co-author lines or "generated with" notes, in code, docs, commits or pull
  requests.
- The Slophammer standards: <https://github.com/osolmaz/slophammer/blob/main/docs/AGENT_ENTRYPOINT.md>.

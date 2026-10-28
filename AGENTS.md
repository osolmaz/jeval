# AGENTS.md

- Read [docs/2026-10-25-switch-plan.md](docs/2026-10-25-switch-plan.md) before you change the design or start a
  phase.
- Run `pnpm check` before you finish: format, lint, typecheck, tests with the 85% coverage gate, the DRY scan, the
  same checks in each example, and `slophammer-ts check .`. CI does not run mutation tests; `pnpm mutate` runs them
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
  view, what the model reads. "State" means only that state; the JSON that the model reads is the view's `json`.
- Do not use their old names: world, history, observation, menu, kind, workspace, log, entry for a step, option and
  action. Use judge only inside legal-judge, for its own judge files. "Entry" still means one line of a trace, and
  "options" still means a settings object, such as `RunOptions`.

## Code

- TypeScript strict, with only erasable syntax: no `enum`, `namespace` or parameter properties. Import with `.ts`
  extensions; no dynamic `import()`.
- No `any`. Data from outside the process (files, model answers, traces) is `unknown` until a zod schema checks it.
- Keep functions under the lint limits: complexity 8 and 80 lines. Split them by responsibility; do not raise a limit.
- A suppression comment needs a reason after `--`.

## No domain in switch

- switch knows nothing about any domain. `src/`, the trace and the page have no domain's words, fields, file formats,
  styles or special cases. This also holds for the comments, help texts and examples in `src/`.
- A domain brings what it needs through switch's general parts: its state, its choice function, its transition
  function, its view function, its questions, its own hooks, and its part of the page with its own styles.
- A concept goes into switch only when it means the same thing for any domain.
- A domain must give an initial state, a choice function and a transition function. The view function, the questions,
  the answer stages and the outcome are optional. Behind these functions, a domain may use any library, program or data
  of its own, and switch never sees it.

## Boundaries

`slophammer.yml` enforces these:

- `src/` is switch, and imports no domain. `src/core` imports nothing else from `src`. It holds the building blocks, the
  loop, the choice checks, the trace, replay and the domain type that runs a domain on case folders.
- `src/models`, `src/view` and `src/testing` import only `src/core`. `src/view` turns a trace into a web page that
  shows any domain's run. A domain may give its own part of the page, such as the chess board: browser modules that
  register hooks with `registerPart`, and a `DomainViewer` that names them and their stylesheets.
- The page joins switch's browser modules in `src/view/web/` and then each part's modules into one script. They import
  each other with plain relative `import { … } from "…/name.ts"` lines and switch's page with
  `import { … } from "@osolmaz/switch/page"`, which the script drops. They take only types from other code, and keep
  their top-level names unique across the whole script.
- `src/cli` wires the others together into `commandLine`, the program of a harness, which takes the harness's domains
  by name.
- Each harness in `examples/` is a package of its own, with its own lint, typecheck, test and coverage settings. It
  imports switch only by the package's name and entry points, such as `@osolmaz/switch/cli`, never by a path out of
  its folder. In this repository the `switch-source` condition points those names at switch's TypeScript sources:
  `tsconfig.json`, the Vitest configs and each example's `src/main.ts` shebang set it.
- A domain's choice function reads only the state and the case's fixed data. In a run, only `load`, the initial state,
  the transition and the view function's reads of the case's own files read files or start programs; the rest of the file and
  process work stays in the domain's `ingest/` folder, `load.ts`, `setup.ts` and `viewer.ts`. A state machine may hold
  a handle to a program outside, such as the chess engine that `load.ts` starts: a replay takes each recorded state and
  runs no transition again.
- Each domain's `setup.ts` exports the function that sets the domain up from a definition file: it loads case folders
  and reports a case. The example's `src/main.ts` passes it to `commandLine`.

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

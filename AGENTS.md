# AGENTS.md

- Read [docs/2026-10-25-switch-plan.md](docs/2026-10-25-switch-plan.md) before you change the design or start a
  phase.
- Run `pnpm check` before you finish: format, lint, typecheck, tests with the 85% coverage gate, the DRY scan and
  `slophammer-ts check .`. CI does not run mutation tests; `pnpm mutate` runs
  them locally on request.
- Add or update a test for every behavior change. Tests make no model calls: use the fake decider in
  `tests/helpers/fakes.ts`.
- Never commit task data: requests, rubrics, documents, answers, case folders, run results, traces or labels. They
  are proprietary. Tests build their own small fixtures in code.

## Terms

- Use the terms of switch, as the README's "How it works" defines them, in code and docs: world, history, step, menu,
  choice, kind, observation, view, state, instructions, question and answer. The menu is the domain's function from the
  world and the history to the choices of the current step.
- Do not use their old names: workspace, log, entry for a step, option and action. Use judge only inside legal-judge,
  for its own judge files. "Entry" still means one line of a trace, and "options" still means a settings object, such
  as `RunOptions`.

## Code

- TypeScript strict, with only erasable syntax: no `enum`, `namespace` or parameter properties. Import with `.ts`
  extensions; no dynamic `import()`.
- No `any`. Data from outside the process (files, model answers, traces) is `unknown` until a zod schema checks it.
- Keep functions under the lint limits: complexity 8 and 80 lines. Split them by responsibility; do not raise a limit.
- A suppression comment needs a reason after `--`.

## Boundaries

`slophammer.yml` enforces these:

- `src/core` imports nothing else from `src`. It holds the building blocks, the loop, the menu, the trace, replay and
  the setup type that runs a domain on case folders.
- `src/models`, `src/eval` and `src/view` import only `src/core`. `src/view` turns a trace into a web page that shows
  any domain's run, and knows no domain. A domain may give its own part of the page, such as the chess board: browser
  modules in the domain's `web/` folder that register hooks with `registerPart`, and a `DomainViewer` that names them.
- The page joins switch's browser modules in `src/view/web/` and then each part's modules into one script. They import
  each other with plain relative `import { … } from "…/name.ts"` lines, which the script drops, take only types from
  other code, and keep their top-level names unique across the whole script.
- A domain under `src/domains/` imports only `src/core`, and `src/view` for its part of the page. Its choices only read
  the world; file and process work stays in its `ingest/` folder, `load.ts`, `setup.ts` and `viewer.ts`. A world may
  hold a handle to a program outside, such as the chess engine that `load.ts` starts: a replay takes each step's
  recorded observation and runs no choice again.
- Each domain's `setup.ts` exports the function that sets the domain up from a definition file: it loads case
  folders and reports a case. Everything a domain needs to run lives in its folder.
- `src/cli` wires the others together. Its list of domains names each domain's setup function and, when the domain has
  one, its part of the viewer, and nothing else about the domain.

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

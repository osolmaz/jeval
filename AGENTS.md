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

## Code

- TypeScript strict, with only erasable syntax: no `enum`, `namespace` or parameter properties. Import with `.ts`
  extensions; no dynamic `import()`.
- No `any`. Data from outside the process (files, model answers, traces) is `unknown` until a zod schema checks it.
- Keep functions under the lint limits: complexity 8 and 80 lines. Split them by responsibility; do not raise a limit.
- A suppression comment needs a reason after `--`.

## Boundaries

`slophammer.yml` enforces these:

- `src/core` imports nothing else from `src`. It holds the building blocks, the loop, the menu and the trace.
- `src/models`, `src/eval` and `src/view` import only `src/core`. `src/view` turns a trace into a web page and draws
  the pictures of the domains it knows, such as the chess board, from the data their steps record. The page joins the
  browser modules in `src/view/web/` into one script, so they import each other with plain
  `import { … } from "./name.ts"` lines, take only types from elsewhere, and keep their top-level names unique.
- A domain under `src/domains/` imports only `src/core`. Its actions only read the workspace; file and process work
  stays in its `ingest/` folder and `load.ts`.
- `src/cli` wires the others together.

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

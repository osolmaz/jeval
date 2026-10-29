# switch viewer

The viewer plays a switch run back in the browser, step by step. It shows each step's questions with the model's
answers, and what the step changed in the state. For each choice question, it shows the choices with the model's
probability for every one and the picked choice, and for a pick, how many choices the limit cut. At the end it shows how the run ended, and why the
case failed if it did. It reads only a run folder, so it works for any domain, and a case's page follows the case live
while it runs, also when a stopped run runs it again.

The viewer is a package of its own, `@osolmaz/switch-viewer`. It uses switch as an outside project would, and switch
knows nothing of it. Like the examples, it runs from its TypeScript sources.

## Add it to a harness

A harness adds the `view` command to switch's command line, with the parts of the page of its domains by name:

```ts
import { commandLine } from "@osolmaz/switch/cli";
import { viewCommand } from "@osolmaz/switch-viewer";
import { triageSetup } from "./setup.ts";

await commandLine({ triage: { setup: triageSetup } })
  .name("triage")
  .addCommand(viewCommand())
  .parseAsync();
```

`view <run>` serves the run on `127.0.0.1`, port 4173 by default, and prints the address of the list of its cases.
`--case <id>` prints the address of one case, and `--port <n>` takes another port. To watch cases while they run,
start `view` on the run folder that `run --out` writes. `view --html <file>` saves one case's page as one HTML file
that opens without the viewer.

## A domain's part of the page

Without a part, the page shows each state as JSON and lists what each step changed. A domain can give its own part,
which draws its states in its own way. The chess example draws a board with moving pieces, arrows for the model's
likeliest moves, the players' bars, a sound button, the move list with the score, and a PGN download.

A part has two halves:

- Browser modules that call `registerPart` from `@osolmaz/switch-viewer/page` with the domain's name and the part's
  hooks. Every hook is optional: `draw` draws a moment of the case, and gets the moment it moves on from, so that it
  can animate the step; `stepNote` adds text after a step's label; `steps` lists the steps beside the drawing; `hidden`
  names the outcome's fields that the result leaves out; and `download` offers a file of the case.
- A `DomainViewer` for the server, which names those modules, the part's stylesheets and the config the part starts
  with, such as its images. It can also give `summary`, a short line on how a case ended, for the list of cases and
  the result's banner.

The page joins its own browser modules and each part's into one script, so a part's modules import each other with
relative `.ts` paths and keep their top-level names unique. The page marks the document with the case's domain, so a
part's stylesheet can restyle the page for its own cases under `:root[data-domain="<domain>"]`. Anything else a part
needs, such as sounds or its own buttons, it draws and runs itself.

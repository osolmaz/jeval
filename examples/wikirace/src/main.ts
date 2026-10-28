#!/usr/bin/env -S node --conditions=switch-source
/** The wikirace harness's command line: switch's run and replay with the wikirace domain, and the viewer's view. */
import { commandLine } from "@osolmaz/switch/cli";
import { viewCommand } from "@osolmaz/switch-viewer";
import { wikiraceSetup } from "./setup.ts";
import { wikiraceViewer } from "./viewer.ts";

await commandLine({ wikirace: { setup: () => wikiraceSetup() } })
	.name("wikirace")
	.addCommand(viewCommand({ wikirace: wikiraceViewer }))
	.parseAsync();

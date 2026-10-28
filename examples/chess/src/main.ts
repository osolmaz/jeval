#!/usr/bin/env -S node --conditions=switch-source
/** The chess harness's command line: switch's run and replay with the chess domain, and the viewer's view with its part. */
import { commandLine } from "@osolmaz/switch/cli";
import { viewCommand } from "@osolmaz/switch-viewer";
import { chessSetup } from "./setup.ts";
import { chessViewer } from "./viewer.ts";

await commandLine({ chess: { setup: chessSetup } })
	.name("chess")
	.addCommand(viewCommand({ chess: chessViewer }))
	.parseAsync();

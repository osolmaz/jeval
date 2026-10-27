#!/usr/bin/env -S node --conditions=switch-source
/** The chess harness's command line: switch's run, replay and view, with the chess domain and its part of the page. */
import { commandLine } from "@osolmaz/switch/cli";
import { chessSetup } from "./setup.ts";
import { chessViewer } from "./viewer.ts";

await commandLine({ chess: { setup: chessSetup, viewer: chessViewer } })
	.name("chess")
	.parseAsync();

#!/usr/bin/env -S node --conditions=switch-source
/**
 * The rubric-judge harness's command line: switch's run and replay with the rubric-judge domain, the viewer's view, and
 * its own ingest, score and compare.
 */
import { commandLine } from "@osolmaz/switch/cli";
import { viewCommand } from "@osolmaz/switch-viewer";
import { ingestCase } from "./ingest/ingest.ts";
import { compareRuns, loadLabelledSet, scoreResults } from "./score/scores.ts";
import { rubricJudgeDomain } from "./setup.ts";

const program = commandLine({ "rubric-judge": rubricJudgeDomain }).name("rubric-judge").addCommand(viewCommand());

program
	.command("ingest")
	.description("Turn an input folder (request.md, rubric.json, documents/, answer/) into a case folder")
	.argument("<input>")
	.argument("<output>")
	.option("--id <id>", "the case id; the input folder's name by default")
	.action(async (input: string, output: string, options: { id?: string }) => {
		await ingestCase(input, output, { id: options.id ?? input.split("/").filter(Boolean).at(-1) ?? "case" });
	});

program
	.command("score")
	.description("Score a run against an eval set's labels, on every case the set schedules")
	.argument("<run>")
	.requiredOption("--set <file>", "the eval set file, with its labels file")
	.option("--json", "print the report as JSON")
	.action(async (run: string, options: { set: string; json?: boolean }) => {
		const { report, text } = await scoreResults(run, await loadLabelledSet(options.set));
		process.stdout.write(`${options.json === true ? JSON.stringify(report, null, 1) : text}\n`);
	});

program
	.command("compare")
	.description("Score runs side by side against an eval set's labels, on the cases that every run answered")
	.argument("<runs...>")
	.requiredOption("--set <file>", "the eval set file, with its labels file")
	.option("--json", "print the comparison as JSON")
	.action(async (runs: string[], options: { set: string; json?: boolean }) => {
		const compared = await compareRuns(runs, await loadLabelledSet(options.set));
		process.stdout.write(`${options.json === true ? JSON.stringify(compared.runs, null, 1) : compared.text}\n`);
	});

await program.parseAsync();

#!/usr/bin/env node
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { Decider } from "../core/index.ts";
import { piAiDecider } from "../models/pi-ai.ts";
import { replayCase, runCases } from "./commands.ts";
import { domainNamed, INGESTERS } from "./domains.ts";
import { compareRuns, scoreResults } from "./scores.ts";
import { loadSet } from "./sets.ts";
import { onlyCase, serveRun, writeCasePage } from "./view.ts";

const positive = (value: string): number => {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("expected a positive whole number");
	return number;
};

type Ingester = (typeof INGESTERS)[string];
const ingesterNamed = (name: string): Ingester => {
	const ingester = INGESTERS[name];
	if (ingester === undefined)
		throw new InvalidArgumentError(`no domain ${name}; known: ${Object.keys(INGESTERS).join(", ")}`);
	return ingester;
};

/** The case folders to run: those of a set, or those named, one or the other. */
async function casesOf(
	folders: readonly string[],
	setFile: string | undefined,
): Promise<{ folders: readonly string[]; set?: { name: string; file: string } }> {
	if (setFile === undefined) {
		if (folders.length === 0) throw new InvalidArgumentError("name case folders or a --set");
		return { folders };
	}
	if (folders.length > 0) throw new InvalidArgumentError("name case folders or a --set, not both");
	const set = await loadSet(setFile);
	return { folders: set.folders, set: { name: set.name, file: resolve(setFile) } };
}

/** The model's API key from `variable`, or from PROVIDER_API_KEY; white space around it is not part of it. */
function decider(model: string, variable: string | undefined): Decider {
	const provider = model.split("/")[0] ?? "";
	const name = variable ?? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
	const apiKey = process.env[name]?.trim();
	return piAiDecider(model, {
		registry: builtinModels(),
		...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
	});
}

const log = (line: string): void => {
	process.stderr.write(`${line}\n`);
};

/** The viewer's default local port. */
const VIEW_PORT = 4173;
const caseUrl = (port: number, id: string): string => `http://127.0.0.1:${String(port)}/case/${encodeURIComponent(id)}`;

const program = new Command()
	.name("switch")
	.description("Let a decision model work through cases by choosing from steps that code lists.");

program
	.command("ingest")
	.description("Turn an input folder (request.md, rubric.json, documents/, answer/) into a case folder")
	.argument("<input>")
	.argument("<output>")
	.option("--domain <name>", "the domain", ingesterNamed, ingesterNamed("legal-judge"))
	.option("--id <id>", "the case id; the input folder's name by default")
	.action(async (input: string, output: string, options: { domain: Ingester; id?: string }) => {
		await options.domain(input, output, options.id ?? input.split("/").filter(Boolean).at(-1) ?? "case");
	});

program
	.command("run")
	.description("Run a domain on case folders into a run folder: run.json, and each case's result, trace and requests")
	.argument("[cases...]", "case folders, when no --set names them")
	.option("--set <file>", "an eval set file; its scheduled cases are run")
	.requiredOption("--out <folder>", "the run folder; a stopped run goes on in its own folder")
	.option("--domain <name>", "the domain: legal-judge or chess", "legal-judge")
	.option("--judge <file>", "the judge definition, for legal-judge; its default judge when none is given")
	.option("--model <provider/id>", "a pi-ai classifier model", "typesafe/jev-latest")
	.option("--api-key-env <variable>", "the environment variable that holds the API key")
	.option("--concurrency <n>", "cases at once", positive, 4)
	.option("--view [port]", "watch the cases in the browser while they run, on this local port", positive)
	.action(
		async (
			cases: string[],
			options: {
				out: string;
				set?: string;
				domain: string;
				judge?: string;
				model: string;
				apiKeyEnv?: string;
				concurrency: number;
				view?: number | true;
			},
		) => {
			const { folders, set } = await casesOf(cases, options.set);
			const domain = await domainNamed(options.domain, options.judge);
			const model = decider(options.model, options.apiKeyEnv);
			if (options.view !== undefined) {
				const port = options.view === true ? VIEW_PORT : options.view;
				await serveRun(options.out, port);
				for (const folder of folders) log(caseUrl(port, await domain.caseId(folder)));
			}
			await runCases(domain, folders, model, {
				out: options.out,
				concurrency: options.concurrency,
				log,
				...(set === undefined ? {} : { set }),
			});
			if (options.view !== undefined) log("The run is done. The viewer stays open until you stop it with Ctrl-C.");
		},
	);

program
	.command("rejudge")
	.description("Judge the cases of a run again with another judge or model, over the evidence that run gathered")
	.argument("[cases...]", "case folders, when no --set names them")
	.option("--set <file>", "an eval set file; its scheduled cases are judged again")
	.requiredOption("--from <run>", "the run whose evidence to reuse")
	.requiredOption("--out <folder>", "the new run folder")
	.option("--domain <name>", "the domain: legal-judge or chess", "legal-judge")
	.option("--judge <file>", "the judge definition, for legal-judge; its default judge when none is given")
	.option("--model <provider/id>", "a pi-ai classifier model", "typesafe/jev-latest")
	.option("--api-key-env <variable>", "the environment variable that holds the API key")
	.option("--concurrency <n>", "cases at once", positive, 4)
	.action(
		async (
			cases: string[],
			options: {
				from: string;
				out: string;
				set?: string;
				domain: string;
				judge?: string;
				model: string;
				apiKeyEnv?: string;
				concurrency: number;
			},
		) => {
			const { folders, set } = await casesOf(cases, options.set);
			await runCases(
				await domainNamed(options.domain, options.judge),
				folders,
				decider(options.model, options.apiKeyEnv),
				{
					out: options.out,
					concurrency: options.concurrency,
					log,
					evidenceFrom: options.from,
					...(set === undefined ? {} : { set }),
				},
			);
		},
	);

program
	.command("replay")
	.description(
		"Run a case again from its trace; with --fork, take the recorded steps and let the model go on from there",
	)
	.argument("<case>")
	.argument("<trace>")
	.option("--domain <name>", "the domain the trace was made with", "legal-judge")
	.option("--judge <file>", "the judge definition the trace was made with, for legal-judge")
	.option("--fork <steps>", "repeat this many recorded steps, then let --model decide", positive)
	.option("--model <provider/id>", "the model for a fork", "typesafe/jev-latest")
	.option("--api-key-env <variable>", "the environment variable that holds the API key")
	.action(
		async (
			folder: string,
			trace: string,
			options: { domain: string; judge?: string; fork?: number; model: string; apiKeyEnv?: string },
		) => {
			const fork =
				options.fork === undefined
					? undefined
					: { steps: options.fork, then: decider(options.model, options.apiKeyEnv) };
			const { result } = await replayCase(await domainNamed(options.domain, options.judge), folder, trace, fork);
			process.stdout.write(
				`${JSON.stringify({ answers: result.answers, steps: result.steps, error: result.error }, null, 1)}\n`,
			);
		},
	);

program
	.command("score")
	.description("Score a run against an eval set's labels, on every case the set schedules")
	.argument("<run>")
	.requiredOption("--set <file>", "the eval set file")
	.option("--json", "print the report as JSON")
	.action(async (run: string, options: { set: string; json?: boolean }) => {
		const { report, text } = await scoreResults(run, await loadSet(options.set));
		process.stdout.write(`${options.json === true ? JSON.stringify(report, null, 1) : text}\n`);
	});

program
	.command("compare")
	.description("Score runs side by side against an eval set's labels, on the cases that every run answered")
	.argument("<runs...>")
	.requiredOption("--set <file>", "the eval set file")
	.option("--json", "print the comparison as JSON")
	.action(async (runs: string[], options: { set: string; json?: boolean }) => {
		const compared = await compareRuns(runs, await loadSet(options.set));
		process.stdout.write(`${options.json === true ? JSON.stringify(compared.runs, null, 1) : compared.text}\n`);
	});

program
	.command("view")
	.description("Show a run's cases step by step in the browser; a case's page follows it while it runs")
	.argument("<run>")
	.option("--case <id>", "the case to open")
	.option("--port <n>", "the local port", positive, VIEW_PORT)
	.option("--html <file>", "write one case's page to a file instead: --case, or the run's only case")
	.action(async (run: string, options: { case?: string; port: number; html?: string }) => {
		if (options.html !== undefined) {
			await writeCasePage(run, options.case ?? (await onlyCase(run)), options.html);
			return;
		}
		await serveRun(run, options.port);
		log(
			options.case === undefined ? `http://127.0.0.1:${String(options.port)}/` : caseUrl(options.port, options.case),
		);
	});

await program.parseAsync();

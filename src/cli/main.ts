#!/usr/bin/env node
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Command, InvalidArgumentError } from "commander";
import { DEFAULT_LIMITS, type Decider } from "../core/index.ts";
import { piAiDecider } from "../models/pi-ai.ts";
import { replayCase, runCases, scoreResults } from "./commands.ts";
import { DOMAINS, type DomainEntry } from "./domains.ts";

const positive = (value: string): number => {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("expected a positive whole number");
	return number;
};

const domainNamed = (name: string): DomainEntry => {
	const domain = DOMAINS[name];
	if (domain === undefined)
		throw new InvalidArgumentError(`no domain ${name}; known: ${Object.keys(DOMAINS).join(", ")}`);
	return domain;
};

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

const program = new Command()
	.name("jeval")
	.description("Let a decision model work through cases by choosing from steps that code lists.");

program
	.command("ingest")
	.description("Turn an input folder (request.md, rubric.json, documents/, answer/) into a case folder")
	.argument("<input>")
	.argument("<output>")
	.option("--domain <name>", "the domain", domainNamed, domainNamed("legal-judge"))
	.option("--id <id>", "the case id; the input folder's name by default")
	.action(async (input: string, output: string, options: { domain: DomainEntry; id?: string }) => {
		await options.domain.ingest(input, output, options.id ?? input.split("/").filter(Boolean).at(-1) ?? "case");
	});

program
	.command("run")
	.description("Run a domain on case folders into a run folder: run.json, and each case's result, trace and requests")
	.argument("<cases...>")
	.requiredOption("--out <folder>", "the run folder; a stopped run goes on in its own folder")
	.option("--domain <name>", "the domain", domainNamed, domainNamed("legal-judge"))
	.option("--model <provider/id>", "a pi-ai classifier model", "typesafe/jev-latest")
	.option("--api-key-env <variable>", "the environment variable that holds the API key")
	.option("--concurrency <n>", "cases at once", positive, 4)
	.option("--steps <n>", "the most steps a case may take", positive, DEFAULT_LIMITS.steps)
	.option("--options <n>", "the most options on a menu", positive, DEFAULT_LIMITS.options)
	.action(
		async (
			cases: string[],
			options: {
				out: string;
				domain: DomainEntry;
				model: string;
				apiKeyEnv?: string;
				concurrency: number;
				steps: number;
				options: number;
			},
		) => {
			const limits = { ...DEFAULT_LIMITS, steps: options.steps, options: options.options };
			await runCases(options.domain, cases, decider(options.model, options.apiKeyEnv), {
				out: options.out,
				concurrency: options.concurrency,
				limits,
				log,
			});
		},
	);

program
	.command("replay")
	.description(
		"Run a case again from its trace; with --fork, take the recorded steps and let the model go on from there",
	)
	.argument("<case>")
	.argument("<trace>")
	.option("--domain <name>", "the domain", domainNamed, domainNamed("legal-judge"))
	.option("--fork <steps>", "repeat this many recorded steps, then let --model decide", positive)
	.option("--model <provider/id>", "the model for a fork", "typesafe/jev-latest")
	.option("--api-key-env <variable>", "the environment variable that holds the API key")
	.action(
		async (
			folder: string,
			trace: string,
			options: { domain: DomainEntry; fork?: number; model: string; apiKeyEnv?: string },
		) => {
			const fork =
				options.fork === undefined
					? undefined
					: { steps: options.fork, then: decider(options.model, options.apiKeyEnv) };
			const { result } = await replayCase(options.domain, folder, trace, fork);
			process.stdout.write(
				`${JSON.stringify({ answers: result.answers, steps: result.steps, error: result.error }, null, 1)}\n`,
			);
		},
	);

program
	.command("score")
	.description("Score a run against reference labels (JSON Lines of {id, items: [{id, pass}]})")
	.argument("<run>")
	.requiredOption("--labels <file>", "the reference labels")
	.option("--cases <file>", "the scheduled case ids, one per line; every labeled result by default")
	.option("--json", "print the report as JSON")
	.action(async (run: string, options: { labels: string; cases?: string; json?: boolean }) => {
		const { report, text } = await scoreResults(run, options.labels, options.cases);
		process.stdout.write(`${options.json === true ? JSON.stringify(report, null, 1) : text}\n`);
	});

await program.parseAsync();

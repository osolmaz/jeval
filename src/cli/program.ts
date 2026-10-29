import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { Decider } from "../core/index.ts";
import { piAiDecider } from "../models/pi-ai.ts";
import { replayCase, runCases } from "./commands.ts";
import { domainFlags, type Domains, runnerNamed } from "./domains.ts";
import { loadSet } from "./sets.ts";

const positive = (value: string): number => {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("expected a positive whole number");
	return number;
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

/**
 * The decider of `model`, with the API key from the environment variable `variable` when one is named, without the
 * white space around it. Without one, pi-ai finds the provider's key itself, such as `TYPESAFE_API_KEY`.
 */
function decider(model: string, variable: string | undefined): Decider {
	const apiKey = variable === undefined ? undefined : process.env[variable]?.trim();
	if (variable !== undefined && (apiKey === undefined || apiKey === "")) {
		throw new InvalidArgumentError(`the environment variable ${variable} holds no API key`);
	}
	return piAiDecider(model, { registry: builtinModels(), ...(apiKey === undefined ? {} : { apiKey }) });
}

const progress = (line: string): void => {
	process.stderr.write(`${line}\n`);
};

const DOMAIN = "the domain; the harness's only domain when it has one";

interface RunFlags {
	readonly out: string;
	readonly set?: string;
	readonly domain?: string;
	readonly model: string;
	readonly apiKeyEnv?: string;
	readonly concurrency: number;
}

/** `command` with the domains' own flags after its own. */
function withDomainFlags(command: Command, domains: Domains): Command {
	for (const flag of domainFlags(domains)) command.addOption(flag);
	return command;
}

function runCommand(domains: Domains): Command {
	const command = new Command("run")
		.description(
			"Run a domain on case folders into a run folder: run.json, and each case's result, trace and requests",
		)
		.argument("[cases...]", "case folders, when no --set names them")
		.option("--set <file>", "an eval set file; its scheduled cases are run")
		.requiredOption("--out <folder>", "the run folder; a stopped run goes on in its own folder")
		.option("--domain <name>", DOMAIN)
		.option("--model <provider/id>", "a pi-ai classifier model", "typesafe/jev-latest")
		.option("--api-key-env <variable>", "the environment variable that holds the API key")
		.option("--concurrency <n>", "cases at once", positive, 4);
	return withDomainFlags(command, domains).action(async (cases: string[], options: RunFlags, self: Command) => {
		const { folders, set } = await casesOf(cases, options.set);
		const domain = await runnerNamed(domains, options.domain, self.opts());
		const model = decider(options.model, options.apiKeyEnv);
		await runCases(domain, folders, model, {
			out: options.out,
			concurrency: options.concurrency,
			progress,
			...(set === undefined ? {} : { set }),
		});
	});
}

interface ReplayFlags {
	readonly domain?: string;
	readonly fork?: number;
	readonly model: string;
	readonly apiKeyEnv?: string;
	readonly out?: string;
}

function replayCommand(domains: Domains): Command {
	const command = new Command("replay")
		.description(
			"Run a case again with the answers, states and ending of its trace; with --fork, the model goes on after the fork. It fails when the case does not repeat the trace",
		)
		.argument("<case>")
		.argument("<trace>")
		.option("--domain <name>", DOMAIN)
		.option("--fork <steps>", "repeat this many recorded steps, then let --model answer", positive)
		.option("--model <provider/id>", "the model for a fork", "typesafe/jev-latest")
		.option("--api-key-env <variable>", "the environment variable that holds the API key")
		.option("--out <folder>", "write the replay to this run folder, as a run of one case");
	return withDomainFlags(command, domains).action(
		async (folder: string, trace: string, options: ReplayFlags, self: Command) => {
			const domain = await runnerNamed(domains, options.domain, self.opts());
			const { fork, out } = options;
			const result = await replayCase(domain, folder, trace, {
				...(fork === undefined ? {} : { fork, decider: decider(options.model, options.apiKeyEnv) }),
				...(out === undefined ? {} : { out }),
			});
			process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
			if (result.thrown !== null) {
				process.stderr.write(`the replay failed: ${result.thrown}\n`);
				process.exitCode = 1;
			}
		},
	);
}

/**
 * The command line of a harness with `domains`: `run` and `replay`, which also take each domain's own flags. A harness
 * can add commands of its own before it parses the arguments, such as one that prepares case folders.
 */
export function commandLine(domains: Domains): Command {
	return new Command()
		.description(
			"A switch harness: a decision model works through cases by answering the questions that code asks at each step.",
		)
		.addCommand(runCommand(domains))
		.addCommand(replayCommand(domains));
}

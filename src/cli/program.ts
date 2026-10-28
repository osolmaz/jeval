import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { Decider } from "../core/index.ts";
import { piAiDecider } from "../models/pi-ai.ts";
import { replayCase, runCases } from "./commands.ts";
import { domainFlags, type Domains, domainNamed } from "./domains.ts";
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

const DOMAIN = "the domain; the harness's only domain when it has one";

interface RunFlags {
	readonly out: string;
	readonly set?: string;
	readonly domain?: string;
	readonly model: string;
	readonly apiKeyEnv?: string;
	readonly concurrency: number;
	readonly stateFrom?: string;
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
		.option("--concurrency <n>", "cases at once", positive, 4)
		.option("--state-from <run>", "take each case's states again from this run, and only ask the questions again");
	return withDomainFlags(command, domains).action(async (cases: string[], options: RunFlags, self: Command) => {
		const { folders, set } = await casesOf(cases, options.set);
		const domain = await domainNamed(domains, options.domain, self.opts());
		const model = decider(options.model, options.apiKeyEnv);
		await runCases(domain, folders, model, {
			out: options.out,
			concurrency: options.concurrency,
			log,
			...(set === undefined ? {} : { set }),
			...(options.stateFrom === undefined ? {} : { stateFrom: options.stateFrom }),
		});
	});
}

interface ReplayFlags {
	readonly domain?: string;
	readonly fork?: number;
	readonly model: string;
	readonly apiKeyEnv?: string;
}

function replayCommand(domains: Domains): Command {
	const command = new Command("replay")
		.description(
			"Run a case again with the picks and states of its trace; with --fork, the model goes on after the fork",
		)
		.argument("<case>")
		.argument("<trace>")
		.option("--domain <name>", DOMAIN)
		.option("--fork <steps>", "repeat this many recorded steps, then let --model decide", positive)
		.option("--model <provider/id>", "the model for a fork", "typesafe/jev-latest")
		.option("--api-key-env <variable>", "the environment variable that holds the API key");
	return withDomainFlags(command, domains).action(
		async (folder: string, trace: string, options: ReplayFlags, self: Command) => {
			const fork =
				options.fork === undefined
					? undefined
					: { steps: options.fork, then: decider(options.model, options.apiKeyEnv) };
			const domain = await domainNamed(domains, options.domain, self.opts());
			const { result } = await replayCase(domain, folder, trace, fork);
			process.stdout.write(
				`${JSON.stringify({ answers: result.answers, steps: result.steps, error: result.error }, null, 1)}\n`,
			);
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
			"A switch harness: a decision model works through cases by picking each step from the choices that code gives.",
		)
		.addCommand(runCommand(domains))
		.addCommand(replayCommand(domains));
}

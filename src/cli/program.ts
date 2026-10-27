import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { Decider } from "../core/index.ts";
import { piAiDecider } from "../models/pi-ai.ts";
import { replayCase, runCases } from "./commands.ts";
import { type Domains, domainNamed, viewersOf } from "./domains.ts";
import { loadSet } from "./sets.ts";
import { onlyCase, serveRun, type Viewers, writeCasePage } from "./view.ts";

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

/** The viewer's default local port. */
const VIEW_PORT = 4173;
const caseUrl = (port: number, id: string): string => `http://127.0.0.1:${String(port)}/case/${encodeURIComponent(id)}`;

const DOMAIN = "the domain; the harness's only domain when it has one";

interface RunFlags {
	readonly out: string;
	readonly set?: string;
	readonly domain?: string;
	readonly definition?: string;
	readonly model: string;
	readonly apiKeyEnv?: string;
	readonly concurrency: number;
	readonly stepsFrom?: string;
	readonly view?: number | true;
}

function runCommand(domains: Domains, viewers: Viewers): Command {
	return new Command("run")
		.description(
			"Run a domain on case folders into a run folder: run.json, and each case's result, trace and requests",
		)
		.argument("[cases...]", "case folders, when no --set names them")
		.option("--set <file>", "an eval set file; its scheduled cases are run")
		.requiredOption("--out <folder>", "the run folder; a stopped run goes on in its own folder")
		.option("--domain <name>", DOMAIN)
		.option("--definition <file>", "the domain's definition, such as a legal judge file; the domain's own by default")
		.option("--model <provider/id>", "a pi-ai classifier model", "typesafe/jev-latest")
		.option("--api-key-env <variable>", "the environment variable that holds the API key")
		.option("--concurrency <n>", "cases at once", positive, 4)
		.option(
			"--steps-from <run>",
			"take each case's steps and observations again from this run, and only ask the questions again",
		)
		.option("--view [port]", "watch the cases in the browser while they run, on this local port", positive)
		.action(async (cases: string[], options: RunFlags) => {
			const { folders, set } = await casesOf(cases, options.set);
			const domain = await domainNamed(domains, options.domain, options.definition);
			const model = decider(options.model, options.apiKeyEnv);
			if (options.view !== undefined) {
				const port = options.view === true ? VIEW_PORT : options.view;
				await serveRun(options.out, port, viewers);
				for (const folder of folders) log(caseUrl(port, await domain.caseId(folder)));
			}
			await runCases(domain, folders, model, {
				out: options.out,
				concurrency: options.concurrency,
				log,
				...(set === undefined ? {} : { set }),
				...(options.stepsFrom === undefined ? {} : { stepsFrom: options.stepsFrom }),
			});
			if (options.view !== undefined) log("The run is done. The viewer stays open until you stop it with Ctrl-C.");
		});
}

interface ReplayFlags {
	readonly domain?: string;
	readonly definition?: string;
	readonly fork?: number;
	readonly model: string;
	readonly apiKeyEnv?: string;
}

function replayCommand(domains: Domains): Command {
	return new Command("replay")
		.description(
			"Run a case again with the steps and observations of its trace; with --fork, the model goes on after the fork",
		)
		.argument("<case>")
		.argument("<trace>")
		.option("--domain <name>", DOMAIN)
		.option("--definition <file>", "the definition the trace was made with; the domain's own by default")
		.option("--fork <steps>", "repeat this many recorded steps, then let --model decide", positive)
		.option("--model <provider/id>", "the model for a fork", "typesafe/jev-latest")
		.option("--api-key-env <variable>", "the environment variable that holds the API key")
		.action(async (folder: string, trace: string, options: ReplayFlags) => {
			const fork =
				options.fork === undefined
					? undefined
					: { steps: options.fork, then: decider(options.model, options.apiKeyEnv) };
			const domain = await domainNamed(domains, options.domain, options.definition);
			const { result } = await replayCase(domain, folder, trace, fork);
			process.stdout.write(
				`${JSON.stringify({ answers: result.answers, steps: result.steps, error: result.error }, null, 1)}\n`,
			);
		});
}

function viewCommand(viewers: Viewers): Command {
	return new Command("view")
		.description("Show a run's cases step by step in the browser; a case's page follows it while it runs")
		.argument("<run>")
		.option("--case <id>", "the case to open")
		.option("--port <n>", "the local port", positive, VIEW_PORT)
		.option("--html <file>", "write one case's page to a file instead: --case, or the run's only case")
		.action(async (run: string, options: { case?: string; port: number; html?: string }) => {
			if (options.html !== undefined) {
				await writeCasePage(run, options.case ?? (await onlyCase(run)), options.html, viewers);
				return;
			}
			await serveRun(run, options.port, viewers);
			log(
				options.case === undefined
					? `http://127.0.0.1:${String(options.port)}/`
					: caseUrl(options.port, options.case),
			);
		});
}

/**
 * The command line of a harness with `domains`: `run`, `replay` and `view`. A harness can add commands of its own
 * before it parses the arguments, such as legal-judge's `ingest`.
 */
export function commandLine(domains: Domains): Command {
	const viewers = viewersOf(domains);
	return new Command()
		.description(
			"A switch harness: a decision model works through cases by choosing each step from a menu that code builds.",
		)
		.addCommand(runCommand(domains, viewers))
		.addCommand(replayCommand(domains))
		.addCommand(viewCommand(viewers));
}

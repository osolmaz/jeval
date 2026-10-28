import { Command, InvalidArgumentError } from "commander";
import { onlyCase, serveRun, type Viewers, writeCasePage } from "./server.ts";

/** The viewer's default local port. */
export const VIEW_PORT = 4173;

const port = (value: string): number => {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("expected a positive whole number");
	return number;
};

interface ViewFlags {
	readonly case?: string;
	readonly port: number;
	readonly html?: string;
}

/**
 * The `view` command for a harness's command line, with `viewers`, the parts of the page of the harness's domains by
 * the domain's name. A harness adds it to switch's: `commandLine(domains).addCommand(viewCommand(viewers))`.
 */
export function viewCommand(viewers: Viewers = {}): Command {
	return new Command("view")
		.description("Show a run's cases step by step in the browser; a case's page follows it while it runs")
		.argument("<run>")
		.option("--case <id>", "the case to open")
		.option("--port <n>", "the local port", port, VIEW_PORT)
		.option("--html <file>", "write one case's page to a file instead: --case, or the run's only case")
		.action(async (run: string, options: ViewFlags) => {
			if (options.html !== undefined) {
				await writeCasePage(run, options.case ?? (await onlyCase(run)), options.html, viewers);
				return;
			}
			await serveRun(run, options.port, viewers);
			const page = options.case === undefined ? "" : `case/${encodeURIComponent(options.case)}`;
			process.stderr.write(`http://127.0.0.1:${String(options.port)}/${page}\n`);
		});
}

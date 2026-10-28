import { Option } from "commander";
import type { Runner } from "../core/index.ts";

/** A command-line flag of a domain's own, with a value, which `run` and `replay` take. */
export interface DomainFlag {
	/** The flag and its value in Commander's form, such as `--rules <file>`. */
	readonly flag: string;
	readonly description: string;
}

/** How a harness sets a domain up: the domain's own flags, and the function that makes its runner from their values. */
export interface DomainSetup {
	readonly flags?: readonly DomainFlag[];
	/** Makes the domain's runner from the values of its own flags, by name, such as `rules` for `--rules`. */
	readonly setup: (flags: Readonly<Record<string, string | undefined>>) => Promise<Runner>;
}

/** The name under which a flag's value comes, such as `rulesFile` for `--rules-file <file>`. */
export const flagName = (flag: DomainFlag): string => new Option(flag.flag).attributeName();

/** A harness's domains: each domain's setup, by the domain's name. */
export type Domains = Readonly<Record<string, DomainSetup>>;

/** A command named a domain that the harness does not have, or none when the harness has more than one. */
export class DomainError extends Error {
	override readonly name = "DomainError";
}

/** The setup of the domain that `name` names, or of the harness's only domain when no name is given. */
export function setupOf(domains: Domains, name: string | undefined): DomainSetup {
	const names = Object.keys(domains);
	const picked = name ?? (names.length === 1 ? names[0] : undefined);
	if (picked === undefined) {
		throw new DomainError(
			`the harness has ${String(names.length)} domains; name one with --domain: ${names.join(", ")}`,
		);
	}
	const domain = domains[picked];
	if (domain === undefined) throw new DomainError(`no domain ${picked}; known: ${names.join(", ")}`);
	return domain;
}

/** Every domain's own flags, each flag once, for a command of the harness. */
export function domainFlags(domains: Domains): Option[] {
	const flags = new Map(
		Object.values(domains).flatMap((domain) => (domain.flags ?? []).map((flag) => [flag.flag, flag])),
	);
	return [...flags.values()].map((flag) => new Option(flag.flag, flag.description));
}

/** The runner of the domain that `name` names, set up with the values of its own flags among a command's `given`. */
export async function runnerNamed(
	domains: Domains,
	name?: string,
	given: Readonly<Record<string, unknown>> = {},
): Promise<Runner> {
	const domain = setupOf(domains, name);
	const values = (domain.flags ?? []).map((flag) => {
		const value = given[flagName(flag)];
		return [flagName(flag), typeof value === "string" ? value : undefined] as const;
	});
	return domain.setup(Object.fromEntries(values));
}

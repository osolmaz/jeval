import type { Runner } from "../core/index.ts";

/** A domain of a harness: how to set it up. */
export interface HarnessDomain {
	/** Makes the domain's runner from a definition file, or from the domain's own definition. */
	readonly setup: (definitionFile: string | undefined) => Promise<Runner>;
}

/** A harness's domains, by name. */
export type Domains = Readonly<Record<string, HarnessDomain>>;

/** A command named a domain that the harness does not have, or none when the harness has more than one. */
export class DomainError extends Error {
	override readonly name = "DomainError";
}

/** The domain that `name` names, or the harness's only domain when no name is given. */
export function domainOf(domains: Domains, name: string | undefined): HarnessDomain {
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

/** A domain ready to run, with the definition in `definitionFile` or with the domain's own. */
export async function domainNamed(domains: Domains, name?: string, definitionFile?: string): Promise<Runner> {
	return domainOf(domains, name).setup(definitionFile);
}

import { describe, expect, it } from "vitest";
import {
	DomainError,
	domainFlags,
	domainNamed,
	domainOf,
	flagName,
	type HarnessDomain,
} from "../../src/cli/domains.ts";
import { commandLine } from "../../src/cli/program.ts";
import { factsSetup } from "../helpers/facts.ts";

describe("a harness's domains", () => {
	it("are picked by name, or the only one without a name", async () => {
		const one = { facts: { setup: factsSetup } };
		expect(domainOf(one, undefined)).toBe(one.facts);
		expect((await domainNamed(one)).name).toBe("facts");
		const two = { facts: { setup: factsSetup }, more: { setup: factsSetup } };
		expect(() => domainOf(two, undefined)).toThrow(DomainError);
		expect(() => domainOf(two, undefined)).toThrow("the harness has 2 domains; name one with --domain: facts, more");
		expect(() => domainOf(two, "poker")).toThrow("no domain poker; known: facts, more");
	});

	it("bring flags of their own, which run and replay take, and get the values of only their own", async () => {
		const seen: Readonly<Record<string, string | undefined>>[] = [];
		const rules = { flag: "--rules-file <file>", description: "the rules" };
		const ruled: HarnessDomain = {
			flags: [rules, { flag: "--level <n>", description: "the level" }],
			setup: (flags) => {
				seen.push(flags);
				return factsSetup();
			},
		};
		const domains = { ruled, facts: { setup: factsSetup }, also: { flags: [rules], setup: factsSetup } };
		expect(flagName(rules)).toBe("rulesFile");
		expect(domainFlags(domains).map((flag) => flag.long)).toEqual(["--rules-file", "--level"]);
		const program = commandLine(domains);
		for (const name of ["run", "replay"]) {
			const command = program.commands.find((found) => found.name() === name);
			expect(command?.options.map((flag) => flag.long)).toEqual(expect.arrayContaining(["--rules-file", "--level"]));
		}
		await domainNamed(domains, "ruled", { rulesFile: "strict.json", level: 3, out: "runs/a" });
		expect(seen).toEqual([{ rulesFile: "strict.json", level: undefined }]);
	});
});

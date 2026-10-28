import { describe, expect, it } from "vitest";
import { DomainError, domainNamed, domainOf } from "../../src/cli/domains.ts";
import { factsSetup } from "../helpers/facts.ts";

describe("a harness's domains", () => {
	it("are picked by name, or the only one without a name", async () => {
		const one = { facts: { setup: factsSetup } };
		expect(domainOf(one, undefined)).toBe(one.facts);
		expect((await domainNamed(one)).name).toBe("facts");
		await expect(domainNamed(one, "facts", "x.json")).rejects.toThrow(/takes no definition file/);
		const two = { facts: { setup: factsSetup }, more: { setup: factsSetup } };
		expect(() => domainOf(two, undefined)).toThrow(DomainError);
		expect(() => domainOf(two, undefined)).toThrow("the harness has 2 domains; name one with --domain: facts, more");
		expect(() => domainOf(two, "poker")).toThrow("no domain poker; known: facts, more");
	});
});

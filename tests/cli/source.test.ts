import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { switchSource } from "../../src/cli/source.ts";
import { packageRoot } from "../../src/cli/root.ts";

describe("switchSource", () => {
	it("names the commit of a Git checkout, and no commit outside one", async () => {
		const here = await switchSource();
		expect(here.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(typeof here.changed).toBe("boolean");
		const folder = await mkdtemp(join(tmpdir(), "switch-source-"));
		try {
			await writeFile(join(folder, "package.json"), JSON.stringify({ version: "9.9.9" }));
			await expect(switchSource(folder)).resolves.toEqual({ version: "9.9.9", commit: null, changed: null });
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	});
});

describe("packageRoot", () => {
	it("finds the package's folder from a module in the sources", () => {
		const root = packageRoot(import.meta.url);
		expect(root).toBe(join(new URL("../../", import.meta.url).pathname).replace(/\/$/, ""));
		expect(() => packageRoot("file:///")).toThrow("no package.json");
	});
});

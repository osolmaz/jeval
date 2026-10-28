import { defineConfig } from "vitest/config";

/**
 * The example imports switch by its package name, and the `switch-source` condition points it at switch's TypeScript
 * sources in this repository, not at its build. The other conditions are Vite's defaults for code that runs in Node.
 */
const conditions = ["switch-source", "module", "node", "development|production"];

export default defineConfig({
	resolve: { conditions },
	ssr: { resolve: { conditions, externalConditions: ["switch-source"] } },
	test: {
		include: ["tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/main.ts"],
			thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
		},
	},
});

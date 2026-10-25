import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["**/.stryker-tmp/**", "dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/cli/main.ts", "src/core/types.ts"],
			thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
		},
	},
});

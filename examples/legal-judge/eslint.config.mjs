import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** The lint rules of switch, which this example keeps as a project of its own. */
export default tseslint.config(
	{
		ignores: ["coverage/**", "eslint.config.mjs"],
	},
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/no-unsafe-assignment": "error",
			"@typescript-eslint/no-unsafe-call": "error",
			"@typescript-eslint/no-unsafe-member-access": "error",
			"@typescript-eslint/no-unsafe-return": "error",
			"@typescript-eslint/switch-exhaustiveness-check": "error",
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
			complexity: ["error", 8],
			"max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
			"max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"max-lines-per-function": ["error", { max: 160, skipBlankLines: true, skipComments: true }],
		},
	},
	// The example uses switch as a project outside it would: by the package's name, never by a path out of its folder.
	...[1, 2].map((depth) => ({
		files: [`${"*/".repeat(depth)}*.ts`],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							regex: `^(\\.\\./){${String(depth + 1)},}`,
							message: "The example imports switch only by its package name, such as @osolmaz/switch.",
						},
					],
				},
			],
		},
	})),
);

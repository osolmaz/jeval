import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The folder of the nearest package.json above a module, so that files beside the package, such as `judges/`, are found
 * the same way from the sources and from the build in `dist/`.
 */
export function packageRoot(moduleUrl: string): string {
	let folder = dirname(fileURLToPath(moduleUrl));
	while (!existsSync(join(folder, "package.json"))) {
		const parent = dirname(folder);
		if (parent === folder) throw new Error(`no package.json above ${fileURLToPath(moduleUrl)}`);
		folder = parent;
	}
	return folder;
}

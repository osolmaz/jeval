import type { MenuItem, State } from "../../core/index.ts";
import type { Workspace } from "./workspace.ts";

const fileOf = (key: string): string => key.split(":")[1] ?? "";

/** Gathering may stop only once no option on the menu would open a file that no step has opened yet. */
export function everyFileOpened(state: State<Workspace>, menu: readonly MenuItem[]): boolean {
	const opened = new Set(state.log.map((entry) => fileOf(entry.key)));
	return !menu.some((item) => (item.action === "read" || item.action === "look") && !opened.has(fileOf(item.key)));
}

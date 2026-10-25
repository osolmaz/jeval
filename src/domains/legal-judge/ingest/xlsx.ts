import type { Element } from "@xmldom/xmldom";
import type { Unit } from "../case.ts";
import { children, elements, Package, R, REL, S, textOf } from "./ooxml.ts";
import { textUnits } from "./units.ts";

const MAX_ROWS = 2000;

function columnIndex(reference: string): number {
	const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A";
	let index = 0;
	for (let position = 0; position < letters.length; position += 1)
		index = index * 26 + letters.charCodeAt(position) - 64;
	return index - 1;
}

function cellValue(cell: Element, shared: readonly string[]): string {
	const type = cell.getAttribute("t");
	if (type === "inlineStr") return textOf(cell, S, "t");
	const value = children(cell, S, "v")[0]?.textContent ?? "";
	if (type === "s") return shared[Number(value)] ?? "";
	return value;
}

function rowLine(row: Element, shared: readonly string[]): string | null {
	const values: string[] = [];
	for (const cell of children(row, S, "c")) {
		const value = cellValue(cell, shared);
		if (value !== "") values[columnIndex(cell.getAttribute("r") ?? "A")] = value;
	}
	if (values.length === 0) return null;
	const cells = Array.from({ length: values.length }, (_, column) => values[column] ?? "");
	return `row ${row.getAttribute("r") ?? "?"}: ${cells.join(" | ")}`;
}

function sheetRows(pkg: Package, part: string, shared: readonly string[]): string[] {
	const root = pkg.xml(part).documentElement;
	if (root === null) return [];
	const rows = elements(root, S, "row");
	const lines = rows.slice(0, MAX_ROWS).flatMap((row) => rowLine(row, shared) ?? []);
	if (rows.length > MAX_ROWS) lines.push("[more rows not shown]");
	return lines;
}

function sharedStrings(pkg: Package): string[] {
	if (!pkg.has("xl/sharedStrings.xml")) return [];
	const root = pkg.xml("xl/sharedStrings.xml").documentElement;
	return root === null ? [] : elements(root, S, "si").map((item) => textOf(item, S, "t"));
}

function sheetParts(pkg: Package): { name: string; part: string }[] {
	const workbook = pkg.xml("xl/workbook.xml").documentElement;
	const rels = pkg.xml("xl/_rels/workbook.xml.rels").documentElement;
	if (workbook === null || rels === null) return [];
	const targets = new Map(
		elements(rels, REL, "Relationship").map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target") ?? ""]),
	);
	return elements(workbook, S, "sheet").map((sheet) => {
		const target = targets.get(sheet.getAttributeNS(R, "id")) ?? "";
		return {
			name: sheet.getAttribute("name") ?? "sheet",
			part: target.startsWith("/") ? target.slice(1) : `xl/${target}`,
		};
	});
}

/** Each sheet's non-empty rows, with cell values placed in their columns. */
export function readXlsx(bytes: Uint8Array): Unit[] {
	const pkg = new Package(bytes);
	const shared = sharedStrings(pkg);
	return sheetParts(pkg).flatMap(({ name, part }) =>
		textUnits(sheetRows(pkg, part, shared).join("\n"), `sheet ${name} rows`, 120).map((unit) => ({
			label: unit.label === "all" ? `sheet ${name}` : unit.label,
			text: unit.text,
		})),
	);
}

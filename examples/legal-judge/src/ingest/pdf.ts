import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Unit } from "../case.ts";

/** A page with fewer characters than this has no usable text layer, such as a scan. */
export const SCAN_TEXT_LIMIT = 40;

/** Each page's text, one unit per page. */
export async function readPdf(bytes: Uint8Array): Promise<Unit[]> {
	const task = getDocument({ data: bytes.slice(), verbosity: 0 });
	const document = await task.promise;
	try {
		const units: Unit[] = [];
		for (let number = 1; number <= document.numPages; number += 1) {
			const page = await document.getPage(number);
			const content = await page.getTextContent();
			const text = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
			units.push({ label: `page ${String(number)}`, text: text.trim() });
		}
		return units;
	} finally {
		await task.destroy();
	}
}

/** The numbers of the pages that have no usable text layer. */
export const scannedPages = (units: readonly Unit[]): number[] =>
	units.flatMap((unit, index) => (unit.text.length < SCAN_TEXT_LIMIT ? [index + 1] : []));

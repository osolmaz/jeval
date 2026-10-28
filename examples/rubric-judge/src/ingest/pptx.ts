import type { Unit } from "../case.ts";
import { A, elements, Package, textOf } from "./ooxml.ts";

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Each slide's text, one paragraph a line, in slide order. */
export function readPptx(bytes: Uint8Array): Unit[] {
	const pkg = new Package(bytes);
	return pkg
		.names()
		.flatMap((name) => {
			const number = SLIDE.exec(name)?.[1];
			return number === undefined ? [] : [{ name, number: Number(number) }];
		})
		.sort((a, b) => a.number - b.number)
		.map(({ name, number }) => {
			const root = pkg.xml(name).documentElement;
			const lines = root === null ? [] : elements(root, A, "p").map((paragraph) => textOf(paragraph, A, "t"));
			return { label: `slide ${String(number)}`, text: lines.filter((line) => line.trim() !== "").join("\n") };
		});
}

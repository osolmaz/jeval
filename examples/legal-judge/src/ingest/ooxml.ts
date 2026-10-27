import { DOMParser, type Document, type Element, type Node } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** The parts of an Office file (a zip archive), by name. */
export class Package {
	private readonly parts: Readonly<Record<string, Uint8Array>>;

	constructor(bytes: Uint8Array) {
		this.parts = unzipSync(bytes);
	}

	names(): string[] {
		return Object.keys(this.parts);
	}

	has(name: string): boolean {
		return name in this.parts;
	}

	xml(name: string): Document {
		const part = this.parts[name];
		if (part === undefined) throw new Error(`the file has no part ${name}`);
		return new DOMParser().parseFromString(new TextDecoder().decode(part), "text/xml");
	}
}

export function elements(parent: Document | Element, namespace: string, name: string): Element[] {
	return Array.from(parent.getElementsByTagNameNS(namespace, name));
}

/** The element children of `parent` in the namespace, with the given local name or, for null, any name. */
export function children(parent: Element, namespace: string, name: string | null): Element[] {
	return Array.from(parent.childNodes).filter(
		(node): node is Element =>
			isElement(node) && node.namespaceURI === namespace && (name === null || node.localName === name),
	);
}

const isElement = (node: Node): node is Element => node.nodeType === 1;

export function textOf(parent: Element, namespace: string, name: string): string {
	return elements(parent, namespace, name)
		.map((element) => element.textContent ?? "")
		.join("");
}

export const squash = (text: string): string => text.split(/\s+/).filter(Boolean).join(" ");

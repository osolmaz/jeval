import type { FileKind, Unit } from "../case.ts";
import { readDocx } from "./docx.ts";
import { readEmail } from "./email.ts";
import { readPdf, scannedPages } from "./pdf.ts";
import { readPptx } from "./pptx.ts";
import type { ImageFormat, Tools } from "./tools.ts";
import { htmlText, textUnits } from "./units.ts";
import { readXlsx } from "./xlsx.ts";

/** An image to store next to the case. */
export interface Picture {
	readonly label: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}

export interface Extracted {
	readonly kind: FileKind;
	readonly units: Unit[];
	readonly pictures: Picture[];
	readonly formatting: string | null;
	readonly marks: number;
}

/** At most this many page images of one PDF's pages without a text layer. */
export const MAX_RENDERS = 12;
/** The longest image side that TypeSafe's Jev accepts: it refuses an image with a side of 1,569 pixels or more. */
export const MAX_IMAGE_SIDE = 1568;
const IMAGES: Readonly<Record<string, ImageFormat | null>> = {
	png: "png",
	jpg: "jpeg",
	jpeg: "jpeg",
	gif: "gif",
	ppm: "ppm",
	webp: null,
};
const TEXT = new Set(["", "md", "txt", "csv", "json", "xml", "rels", "html", "htm"]);

const extensionOf = (path: string): string => {
	const name = path.split("/").at(-1) ?? path;
	return name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
};

const plain = (kind: FileKind, units: Unit[]): Extracted => ({ kind, units, pictures: [], formatting: null, marks: 0 });

async function pdf(bytes: Uint8Array, tools: Tools): Promise<Extracted> {
	const units = await readPdf(bytes);
	const pictures: Picture[] = [];
	for (const page of scannedPages(units).slice(0, MAX_RENDERS)) {
		const png = await tools.renderPdfPage(bytes, page);
		if (png === null) continue;
		const fitted = await tools.fitImage(png, "png", MAX_IMAGE_SIDE);
		pictures.push({ label: `page ${String(page)} image`, ...fitted });
	}
	return { kind: "pdf", units, pictures, formatting: null, marks: 0 };
}

function text(extension: string, bytes: Uint8Array): Extracted {
	const decoded = new TextDecoder().decode(bytes);
	return plain("text", textUnits(extension === "html" || extension === "htm" ? htmlText(decoded) : decoded));
}

async function image(extension: string, bytes: Uint8Array, tools: Tools): Promise<Extracted> {
	const format = IMAGES[extension];
	if (format === undefined || format === null) throw new Error(`${extension} images are not supported`);
	const fitted = await tools.fitImage(bytes, format, MAX_IMAGE_SIDE);
	return { kind: "image", units: [], pictures: [{ label: "image", ...fitted }], formatting: null, marks: 0 };
}

function docx(bytes: Uint8Array): Extracted {
	const word = readDocx(bytes);
	return { kind: "docx", units: word.units, pictures: [], formatting: word.formatting, marks: word.marks };
}

const READERS: Readonly<Record<string, (bytes: Uint8Array, tools: Tools) => Promise<Extracted>>> = {
	pdf,
	docx: (bytes) => Promise.resolve(docx(bytes)),
	xlsx: (bytes) => Promise.resolve(plain("sheet", readXlsx(bytes))),
	pptx: (bytes) => Promise.resolve(plain("slides", readPptx(bytes))),
	eml: async (bytes) => plain("email", await readEmail(bytes)),
	doc: async (bytes, tools) => plain("text", textUnits(await tools.docText(bytes))),
};

/** A file's text, parts and images, by its extension. A format jeval does not read gives a file with no parts. */
export async function extractFile(path: string, bytes: Uint8Array, tools: Tools): Promise<Extracted> {
	const extension = extensionOf(path);
	if (extension in IMAGES) return image(extension, bytes, tools);
	const reader = READERS[extension];
	if (reader !== undefined) return reader(bytes, tools);
	return TEXT.has(extension) ? text(extension, bytes) : plain("other", []);
}

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The image formats that Netpbm decodes. */
export type ImageFormat = "png" | "jpeg" | "gif" | "ppm";

/** An image that fits: the original bytes when they already did, otherwise a scaled PNG. */
export interface FittedImage {
	readonly bytes: Uint8Array;
	readonly mimeType: "image/png" | "image/jpeg";
}

/** The programs ingestion needs beyond Node: Poppler for page images, LibreOffice for legacy Word, Netpbm for images. */
export interface Tools {
	/** A PNG of one PDF page, or null when the page could not be rendered. */
	renderPdfPage(pdf: Uint8Array, page: number): Promise<Uint8Array | null>;
	/** The text of a legacy .doc file. */
	docText(doc: Uint8Array): Promise<string>;
	/**
	 * The image with neither side longer than `maxSide` pixels: a PNG or JPEG that fits is kept as it is, anything else
	 * becomes a PNG, scaled down when it is too large.
	 */
	fitImage(image: Uint8Array, format: ImageFormat, maxSide: number): Promise<FittedImage>;
}

const DECODERS: Readonly<Record<ImageFormat, string | null>> = {
	png: "pngtopnm",
	jpeg: "jpegtopnm",
	gif: "giftopnm",
	ppm: null,
};
const BUFFER = { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 } as const;

/** The width and height in a PNM header: a magic number, then the width and height, with `#` comments allowed. */
export function pnmSize(pnm: Uint8Array): { width: number; height: number } {
	const header = new TextDecoder("latin1").decode(pnm.subarray(0, 512)).replace(/#[^\n]*\n/g, " ");
	const match = /^P[1-6]\s+(\d+)\s+(\d+)/.exec(header);
	if (match === null) throw new Error("not a PNM image");
	return { width: Number(match[1]), height: Number(match[2]) };
}

async function inTemporaryFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
	const folder = await mkdtemp(join(tmpdir(), "jeval-"));
	try {
		return await work(folder);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
}

/** The tools as installed programs: `pdftoppm`, `soffice`, and Netpbm's decoders, `pamscale` and `pnmtopng`. */
export const systemTools: Tools = {
	renderPdfPage: (pdf, page) =>
		inTemporaryFolder(async (folder) => {
			await writeFile(join(folder, "in.pdf"), pdf);
			const pageArgument = String(page);
			try {
				await run(
					"pdftoppm",
					["-r", "110", "-png", "-singlefile", "-f", pageArgument, "-l", pageArgument, "in.pdf", "out"],
					{ cwd: folder },
				);
			} catch {
				return null;
			}
			return new Uint8Array(await readFile(join(folder, "out.png")));
		}),
	docText: (doc) =>
		inTemporaryFolder(async (folder) => {
			await writeFile(join(folder, "in.doc"), doc);
			await run("soffice", ["--headless", "--convert-to", "txt:Text", "--outdir", folder, join(folder, "in.doc")], {
				timeout: 120_000,
			});
			return readFile(join(folder, "in.txt"), "utf8");
		}),
	fitImage: (image, format, maxSide) =>
		inTemporaryFolder(async (folder) => {
			const input = join(folder, "in");
			await writeFile(input, image);
			const decoder = DECODERS[format];
			const pnm = decoder === null ? image : new Uint8Array((await run(decoder, [input], BUFFER)).stdout);
			const { width, height } = pnmSize(pnm);
			const fits = width <= maxSide && height <= maxSide;
			if (fits && format === "png") return { bytes: image, mimeType: "image/png" };
			if (fits && format === "jpeg") return { bytes: image, mimeType: "image/jpeg" };
			const decoded = join(folder, "in.pnm");
			await writeFile(decoded, pnm);
			const scaled = fits
				? decoded
				: await (async () => {
						const { stdout } = await run(
							"pamscale",
							["-xyfit", String(maxSide), String(maxSide), decoded],
							BUFFER,
						);
						await writeFile(join(folder, "scaled.pnm"), stdout);
						return join(folder, "scaled.pnm");
					})();
			const { stdout } = await run("pnmtopng", [scaled], BUFFER);
			return { bytes: new Uint8Array(stdout), mimeType: "image/png" };
		}),
};

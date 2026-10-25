import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The programs ingestion needs beyond Node: Poppler for page images, LibreOffice for legacy Word, Netpbm for PPM. */
export interface Tools {
	/** A PNG of one PDF page, or null when the page could not be rendered. */
	renderPdfPage(pdf: Uint8Array, page: number): Promise<Uint8Array | null>;
	/** The text of a legacy .doc file. */
	docText(doc: Uint8Array): Promise<string>;
	/** A PNG of a PPM image. */
	ppmToPng(ppm: Uint8Array): Promise<Uint8Array>;
}

async function inTemporaryFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
	const folder = await mkdtemp(join(tmpdir(), "jeval-"));
	try {
		return await work(folder);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
}

/** The tools as installed programs: `pdftoppm`, `soffice` and `pnmtopng`. */
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
	ppmToPng: (ppm) =>
		inTemporaryFolder(async (folder) => {
			await writeFile(join(folder, "in.ppm"), ppm);
			const { stdout } = await run("pnmtopng", [join(folder, "in.ppm")], {
				encoding: "buffer",
				maxBuffer: 64 * 1024 * 1024,
			});
			return new Uint8Array(stdout);
		}),
};

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { readDocx } from "../../../src/domains/legal-judge/ingest/docx.ts";
import { readEmail } from "../../../src/domains/legal-judge/ingest/email.ts";
import { extractFile, MAX_RENDERS } from "../../../src/domains/legal-judge/ingest/extract.ts";
import { ingestCase } from "../../../src/domains/legal-judge/ingest/ingest.ts";
import { Package } from "../../../src/domains/legal-judge/ingest/ooxml.ts";
import { readPdf, scannedPages } from "../../../src/domains/legal-judge/ingest/pdf.ts";
import { readPptx } from "../../../src/domains/legal-judge/ingest/pptx.ts";
import type { Tools } from "../../../src/domains/legal-judge/ingest/tools.ts";
import { countWords, htmlText, textUnits } from "../../../src/domains/legal-judge/ingest/units.ts";
import { readXlsx } from "../../../src/domains/legal-judge/ingest/xlsx.ts";
import { loadCase } from "../../../src/domains/legal-judge/load.ts";
import { docxBytes, emailBytes, pdfBytes, pptxBytes, xlsxBytes, zip } from "../../helpers/office.ts";

const PNG = new Uint8Array([137, 80, 78, 71]);
const tools: Tools = {
	renderPdfPage: (_, page) => Promise.resolve(page === 2 ? null : PNG),
	docText: () => Promise.resolve("legacy text"),
	ppmToPng: () => Promise.resolve(PNG),
};

describe("text", () => {
	it("splits long text into groups of lines and counts words", () => {
		expect(textUnits("a\nb")).toEqual([{ label: "all", text: "a\nb" }]);
		const units = textUnits(Array.from({ length: 5 }, (_, index) => `line ${String(index)}`).join("\n"), "rows", 2);
		expect(units.map((unit) => unit.label)).toEqual(["rows 1-2", "rows 3-4", "rows 5-5"]);
		expect(countWords(units)).toBe(10);
	});

	it("keeps an HTML page's visible text and decodes entities", () => {
		expect(htmlText("<style>p{}</style><p>A &amp; B&nbsp;&#67;&#x44;</p><br/>&unknown;")).toBe(
			" A & B CD\n\n&unknown;",
		);
	});
});

describe("Word", () => {
	it("reads numbered paragraphs with styles, tables, tracked changes, comments and formatted runs", () => {
		const word = readDocx(docxBytes());
		expect(word.units[0]?.text).toBe(
			"P1 [Heading1]: Terms\nP2: Rent is due monthly\nTABLE 1:\n  row 1: Party | Role",
		);
		expect(word.marks).toBe(3);
		expect(word.formatting).toBe(
			[
				"Tracked insertions: 1; tracked deletions: 1.",
				"  inserted: monthly",
				"  deleted: weekly",
				"Comments: 1.",
				"  comment: Check this",
				"Runs with direct formatting: 1.",
				"  P2 b: Rent",
			].join("\n"),
		);
		expect(readDocx(docxBytes(false)).marks).toBe(2);
	});

	it("refuses a Word file without a body, and an archive without the part asked for", () => {
		const empty = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';
		expect(() => readDocx(zip({ "word/document.xml": empty }))).toThrow(/no body/);
		expect(() => new Package(zip({})).xml("missing.xml")).toThrow(/no part missing.xml/);
	});
});

describe("spreadsheet", () => {
	it("reads each sheet's rows with values in their columns", () => {
		const units = readXlsx(xlsxBytes());
		expect(units[0]).toEqual({ label: "sheet Fees", text: "row 1: Item |  | Amount\nrow 2: Rent |  | 2500" });
		expect(units[1]).toEqual({ label: "sheet Long", text: "row 1: 0\nrow 2: 1\nrow 3: 2" });
	});

	it("splits a long sheet and stops after its row limit", () => {
		const units = readXlsx(xlsxBytes(2005));
		const long = units.filter((unit) => unit.label.startsWith("sheet Long"));
		expect(long[0]?.label).toBe("sheet Long rows 1-120");
		expect(long.at(-1)?.text.endsWith("[more rows not shown]")).toBe(true);
	});
});

describe("slides, email and PDF", () => {
	it("reads slides in their numbered order", () => {
		expect(readPptx(pptxBytes())).toEqual([
			{ label: "slide 2", text: "Second" },
			{ label: "slide 10", text: "Last" },
		]);
	});

	it("reads an email's headers, text and attachment names, and its HTML when it has no plain text", async () => {
		const [plain] = await readEmail(emailBytes());
		expect(plain?.text).toContain("From: Ana Lee <ana@example.com>\nTo: Team: bo@example.com, cy@example.com\nDate:");
		expect(plain?.text).toContain("Subject: Lease\n\nPlease review.\n[attachment: lease.pdf]");
		const [html] = await readEmail(emailBytes(true));
		expect(html?.text).toContain("Please & review");
		expect(html?.text).not.toContain("x()");
	});

	it("reads each PDF page's text and finds the pages without a text layer", async () => {
		const units = await readPdf(pdfBytes(["Section 4.2 sets a notice period of thirty days.", ""]));
		expect(units.map((unit) => unit.label)).toEqual(["page 1", "page 2"]);
		expect(units[0]?.text).toContain("notice period");
		expect(scannedPages(units)).toEqual([2]);
	});
});

describe("extractFile", () => {
	it("chooses the reader by extension", async () => {
		const pdf = await extractFile(
			"scan.pdf",
			pdfBytes(["", "", "Readable text on the third page of this file."]),
			tools,
		);
		expect(pdf.pictures.map((picture) => picture.label)).toEqual(["page 1 image"]);
		expect(MAX_RENDERS).toBe(12);
		expect((await extractFile("a.docx", docxBytes(), tools)).kind).toBe("docx");
		expect((await extractFile("a.xlsx", xlsxBytes(), tools)).kind).toBe("sheet");
		expect((await extractFile("a.pptx", pptxBytes(), tools)).kind).toBe("slides");
		expect((await extractFile("a.eml", emailBytes(), tools)).kind).toBe("email");
		expect((await extractFile("a.doc", PNG, tools)).units).toEqual([{ label: "all", text: "legacy text" }]);
		expect((await extractFile("page.html", strToU8("<b>Hi</b>"), tools)).units[0]?.text).toBe(" Hi ");
		expect((await extractFile("NOTES", strToU8("plain"), tools)).kind).toBe("text");
		expect(await extractFile("photo.JPG", PNG, tools)).toMatchObject({
			kind: "image",
			pictures: [{ mimeType: "image/jpeg" }],
		});
		expect(await extractFile("frame.ppm", PNG, tools)).toMatchObject({
			kind: "image",
			pictures: [{ mimeType: "image/png" }],
		});
		expect(await extractFile("model.bin", PNG, tools)).toMatchObject({ kind: "other", units: [] });
	});
});

describe("ingestCase and loadCase", () => {
	let folder = "";
	afterEach(async () => {
		await rm(folder, { recursive: true, force: true });
	});

	it("turns an input folder into a case folder that loads back with its images", async () => {
		folder = await mkdtemp(join(tmpdir(), "jeval-test-"));
		const input = join(folder, "input");
		await mkdir(join(input, "answer", "files"), { recursive: true });
		await mkdir(join(input, "documents"), { recursive: true });
		await writeFile(join(input, "request.md"), "Review the lease.");
		await writeFile(
			join(input, "rubric.json"),
			JSON.stringify({
				items: [
					{ id: "S-1", text: "PASS if it names the rent." },
					{ id: "F-1", category: "form", text: "PASS if short." },
				],
			}),
		);
		await writeFile(join(input, "answer", "files", "memo.md"), "The rent is due monthly.");
		await writeFile(join(input, "documents", "scan.pdf"), pdfBytes([""]));
		await writeFile(join(input, "documents", "broken.docx"), strToU8("not a zip"));
		const legalCase = await ingestCase(input, join(folder, "case"), { id: "case-1", tools });
		expect(legalCase.files.map((file) => [file.id, file.path, file.kind, file.error === null])).toEqual([
			["a1", "output/files/memo.md", "text", true],
			["d1", "documents/broken.docx", "other", false],
			["d2", "documents/scan.pdf", "pdf", true],
		]);
		expect(legalCase.items[0]).toEqual({ id: "S-1", category: null, text: "PASS if it names the rent." });
		const workspace = await loadCase(join(folder, "case"));
		expect(workspace.case).toEqual(legalCase);
		const render = legalCase.files[2]?.renders[0];
		expect(render?.path).toBe("images/d2-1.png");
		if (render !== undefined)
			await expect(workspace.image(render)).resolves.toMatchObject({ data: Buffer.from(PNG).toString("base64") });
		expect(JSON.parse(await readFile(join(folder, "case", "case.json"), "utf8"))).toMatchObject({ id: "case-1" });
	});

	it("reads a case with no documents folder", async () => {
		folder = await mkdtemp(join(tmpdir(), "jeval-test-"));
		await mkdir(join(folder, "in", "answer"), { recursive: true });
		await writeFile(join(folder, "in", "request.md"), "Draft a clause.");
		await writeFile(
			join(folder, "in", "rubric.json"),
			JSON.stringify({ items: [{ id: "S-1", text: "PASS if x." }] }),
		);
		await writeFile(join(folder, "in", "answer", "clause.txt"), "Clause.");
		const legalCase = await ingestCase(join(folder, "in"), join(folder, "out"), { id: "c", tools });
		expect(legalCase.files).toHaveLength(1);
	});
});

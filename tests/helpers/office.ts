import { strToU8, zipSync } from "fflate";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function zip(parts: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}

/** A Word file: a styled heading, a paragraph with a bold run and a tracked insertion and deletion, a table, a comment. */
export function docxBytes(withComments = true): Uint8Array {
	const body = `<w:body>
		<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Terms</w:t></w:r></w:p>
		<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Rent</w:t></w:r><w:r><w:rPr><w:i w:val="0"/></w:rPr><w:t> is due </w:t></w:r><w:ins><w:r><w:t>monthly</w:t></w:r></w:ins><w:del><w:r><w:delText>weekly</w:delText></w:r></w:del></w:p>
		<w:p><w:r><w:t>  </w:t></w:r></w:p>
		<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Party</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Role</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
	</w:body>`;
	const parts: Record<string, string> = { "word/document.xml": `<w:document ${W}>${body}</w:document>` };
	if (withComments)
		parts["word/comments.xml"] =
			`<w:comments ${W}><w:comment><w:p><w:r><w:t>Check this</w:t></w:r></w:p></w:comment></w:comments>`;
	return zip(parts);
}

const S =
	'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook with two sheets: shared and inline strings, a gap between columns, and one sheet past the row limit. */
export function xlsxBytes(rows = 3): Uint8Array {
	const many = Array.from(
		{ length: rows },
		(_, index) => `<row r="${String(index + 1)}"><c r="A${String(index + 1)}"><v>${String(index)}</v></c></row>`,
	).join("");
	return zip({
		"xl/workbook.xml": `<workbook ${S}><sheets><sheet name="Fees" r:id="rId1"/><sheet name="Long" r:id="rId2"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
		"xl/sharedStrings.xml": `<sst ${S}><si><t>Item</t></si><si><t>Amount</t></si></sst>`,
		"xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Rent</t></is></c><c r="C2"><v>2500</v></c></row><row r="3"><c r="A3"/></row></sheetData></worksheet>`,
		"xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData>${many}</sheetData></worksheet>`,
	});
}

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

export function pptxBytes(): Uint8Array {
	const slide = (text: string) =>
		`<p:sld xmlns:p="p" ${A}><a:p><a:r><a:t>${text}</a:t></a:r></a:p><a:p><a:r><a:t> </a:t></a:r></a:p></p:sld>`;
	return zip({
		"ppt/slides/slide10.xml": slide("Last"),
		"ppt/slides/slide2.xml": slide("Second"),
		"ppt/presentation.xml": "<p/>",
	});
}

/** A PDF whose pages hold the given text; an empty string gives a page without a text layer. */
export function pdfBytes(pages: readonly string[]): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => objects.push(body) + 1;
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	const pageIds = pages.map((text) => {
		const stream = text === "" ? "" : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
		const content = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
		return add(
			`<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Contents ${String(content)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >> >>`,
		);
	});
	const all = [
		`<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages.length)} >>`,
		...objects,
	];
	let text = "%PDF-1.4\n";
	const offsets: number[] = [];
	all.forEach((body, index) => {
		offsets.push(text.length);
		text += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
	});
	const catalog = all.length + 1;
	offsets.push(text.length);
	text += `${String(catalog)} 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n`;
	const xref = text.length;
	text += `xref\n0 ${String(catalog + 1)}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
	text += `trailer\n<< /Size ${String(catalog + 1)} /Root ${String(catalog)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
	return strToU8(text);
}

export const emailBytes = (html = false): Uint8Array =>
	strToU8(
		[
			"From: Ana Lee <ana@example.com>",
			"To: Team: bo@example.com, cy@example.com;",
			"Subject: Lease",
			"Date: Mon, 2 Mar 2026 10:00:00 +0000",
			"MIME-Version: 1.0",
			'Content-Type: multipart/mixed; boundary="b"',
			"",
			"--b",
			`Content-Type: ${html ? "text/html" : "text/plain"}; charset=utf-8`,
			"",
			html ? "<p>Please &amp; review</p><script>x()</script>" : "Please review.",
			"--b",
			'Content-Type: application/pdf; name="lease.pdf"',
			'Content-Disposition: attachment; filename="lease.pdf"',
			"Content-Transfer-Encoding: base64",
			"",
			"JVBERg==",
			"--b--",
			"",
		].join("\r\n"),
	);

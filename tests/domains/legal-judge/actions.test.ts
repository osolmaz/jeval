import { describe, expect, it } from "vitest";
import type { Entry, MenuItem, State } from "../../../src/core/index.ts";
import { changes, trackedChanges } from "../../../src/domains/legal-judge/actions/changes.ts";
import { compare, compareFiles } from "../../../src/domains/legal-judge/actions/compare.ts";
import { count, countWords } from "../../../src/domains/legal-judge/actions/count.ts";
import { look } from "../../../src/domains/legal-judge/actions/look.ts";
import { read } from "../../../src/domains/legal-judge/actions/read.ts";
import { search, searchFiles } from "../../../src/domains/legal-judge/actions/search.ts";
import { LIMITS, type Workspace } from "../../../src/domains/legal-judge/workspace.ts";
import { file, legalCase, workspaceOf } from "../../helpers/cases.ts";

const state = (workspace: Workspace, log: Entry[] = []): State<Workspace> => ({ workspace, log });
const texts = (items: readonly MenuItem[]) => items.map((item) => item.text);
const entry = (key: string, text = "x", images = 0): Entry => ({
	action: key.split(":")[0] ?? "",
	key,
	observation: {
		source: key,
		text,
		images: Array.from({ length: images }, () => ({ label: "i", mimeType: "image/png", data: "" })),
	},
});

describe("read", () => {
	it("offers a small file whole and reads it", async () => {
		const items = read.items(state(workspaceOf(legalCase())));
		expect(texts(items)).toContain("Read all of documents/lease.pdf (pdf, 2 parts, ~15 words)");
		const lease = items.find((item) => item.key === "read:d1:0-1");
		await expect(lease?.run()).resolves.toEqual({
			source: "documents/lease.pdf",
			text: "[page 1]\nSection 4.2 sets a notice period of 30 days.\n\n[page 2]\nRent is USD 2,500 a month.",
		});
	});

	it("offers the unread parts of a large or partly read file, the first part ahead of the others", async () => {
		const page = "word ".repeat(4000);
		const big = legalCase({
			files: [file("d1", "documents/big.pdf", "document", [page, page, page, ""], { kind: "pdf" })],
		});
		const items = read.items(state(workspaceOf(big)));
		expect(items.map((item) => [item.key, item.priority])).toEqual([
			["read:d1:0-0", 0],
			["read:d1:1-1", 2],
			["read:d1:2-2", 2],
		]);
		await expect(items[1]?.run()).resolves.toMatchObject({ source: "documents/big.pdf, page 2" });
		const partly = read.items(state(workspaceOf(legalCase()), [entry("read:d1:0-0")]));
		expect(texts(partly)).toContain("Read documents/lease.pdf, page 2 (6 words)");
	});

	it("offers nothing that does not fit the evidence budget, and no image or unreadable file", () => {
		const full = [entry("read:a1:0-0", "x".repeat(LIMITS.evidenceTokens * LIMITS.charsPerToken))];
		expect(read.items(state(workspaceOf(legalCase()), full))).toEqual([]);
		const odd = legalCase({
			files: [
				file("d1", "documents/a.png", "document", [], { kind: "image" }),
				file("d2", "documents/b.doc", "document", ["x"], { error: "broken" }),
			],
		});
		expect(read.items(state(workspaceOf(odd)))).toEqual([]);
	});
});

describe("look", () => {
	const scanned = legalCase({
		files: [
			file("d1", "documents/scan.pdf", "document", [""], {
				kind: "pdf",
				renders: [{ label: "page 1 image", path: "images/d1-1.png", mimeType: "image/png" }],
			}),
			file("d2", "documents/photo.png", "document", [], {
				kind: "image",
				renders: [{ label: "image", path: "images/d2-1.png", mimeType: "image/png" }],
			}),
		],
	});

	it("offers page images and image files, and returns the image", async () => {
		const items = look.items(state(workspaceOf(scanned)));
		expect(texts(items)).toEqual([
			"Look at documents/scan.pdf page 1 image (the page has no text layer)",
			"Look at documents/photo.png",
		]);
		await expect(items[0]?.run()).resolves.toEqual({
			source: "documents/scan.pdf page 1 image",
			text: "[image: documents/scan.pdf page 1 image]",
			images: [{ label: "page 1 image", mimeType: "image/png", data: "data:images/d1-1.png" }],
		});
		await expect(items[1]?.run()).resolves.toMatchObject({ source: "documents/photo.png" });
	});

	it("stops once the case has seen its images", () => {
		expect(look.items(state(workspaceOf(scanned), [entry("look:x", "x", LIMITS.images)]))).toEqual([]);
	});
});

describe("search", () => {
	it("offers the case's terms with the items they come from, and finds every passage", async () => {
		const items = search.items(state(workspaceOf(legalCase())));
		const notice = items.find((item) => item.key === "search:notice period");
		expect(notice).toMatchObject({
			informs: ["S-001"],
			priority: 1,
			text: "Find the passages in the answer and the documents that mention “notice period” (from S-001)",
		});
		await expect(notice?.run()).resolves.toMatchObject({ source: "search for “notice period”" });
		const searched = search.items(state(workspaceOf(legalCase()), [entry("search:notice period")]));
		expect(searched.map((item) => item.key)).not.toContain("search:notice period");
	});

	it("labels a passage with its part, and says when nothing matches", () => {
		const found = searchFiles(legalCase().files, "rent");
		expect(found).toContain("documents/lease.pdf, page 2: …Rent is USD 2,500 a month.…");
		expect(searchFiles(legalCase().files, "arbitration")).toBe("Not found in any file.");
	});
});

describe("count", () => {
	it("is offered when an item is about length, and counts words under each heading", async () => {
		const [item] = count.items(state(workspaceOf(legalCase())));
		expect(item?.text).toBe("Count the words of the answer, in total and for each section");
		await expect(item?.run()).resolves.toEqual({
			source: "word counts of the answer",
			text: "output/memo.md: 15 words in total.\n  Memo: 9 words\n  Advice: 2 words",
		});
		const noLength = legalCase({ items: [{ id: "S-1", category: null, text: "PASS if it names the landlord." }] });
		expect(count.items(state(workspaceOf(noLength)))).toEqual([]);
	});

	it("counts text before the first heading too", () => {
		expect(countWords(file("a1", "output/a.md", "answer", ["one two\n**Terms**\nthree"]))).toBe(
			"output/a.md: 4 words in total.\n  (before the first heading): 2 words\n  Terms: 1 words",
		);
	});
});

describe("changes", () => {
	it("lists the tracked changes of a marked document without its formatted runs", async () => {
		const [item] = changes.items(state(workspaceOf(legalCase())));
		expect(item?.text).toBe("List the tracked changes and comments in documents/contract.docx");
		await expect(item?.run()).resolves.toEqual({
			source: "documents/contract.docx: tracked changes and comments",
			text: "Tracked insertions: 1; tracked deletions: 0.\n  inserted: agree\nComments: 0.",
		});
		expect(trackedChanges(file("x", "x", "document", []))).toBe("");
	});
});

describe("compare", () => {
	const edited = file("a1", "output/Contract.docx", "answer", ["P1: The parties agree.\nP2 [Heading1]: New clause."], {
		kind: "docx",
	});
	const original = file("d2", "documents/contract.docx", "document", ["P1: The parties agree.\nP2: Old clause."], {
		kind: "docx",
	});

	it("pairs the answer's Word file with the document of the same name, and lists added and removed paragraphs", async () => {
		const [item] = compare.items(state(workspaceOf(legalCase({ files: [edited, original] }))));
		expect(item?.text).toBe(
			"Compare output/Contract.docx with the original documents/contract.docx, paragraph by paragraph",
		);
		await expect(item?.run()).resolves.toMatchObject({
			source: "output/Contract.docx compared with documents/contract.docx",
		});
		expect(compareFiles(edited, original)).toBe(
			"1 paragraphs in the answer are not in the original; 1 paragraphs of the original are not in the answer.\n+ New clause.\n- Old clause.",
		);
	});

	it("offers nothing without a matching original", () => {
		expect(compare.items(state(workspaceOf(legalCase({ files: [edited] }))))).toEqual([]);
	});
});

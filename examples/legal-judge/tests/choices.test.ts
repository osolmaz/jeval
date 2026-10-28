import { describe, expect, it } from "vitest";
import type { Choice } from "@osolmaz/switch";
import { changes, trackedChanges } from "../src/choices/changes.ts";
import { compare, compareFiles } from "../src/choices/compare.ts";
import { count, countWords } from "../src/choices/count.ts";
import { look } from "../src/choices/look.ts";
import { read } from "../src/choices/read.ts";
import { search, searchFiles } from "../src/choices/search.ts";
import { LIMITS } from "../src/state.ts";
import { searchTerms } from "../src/terms.ts";
import { evidence, file, legalCase, stateOf } from "./helpers/cases.ts";

const texts = (choices: readonly Choice[]) => choices.map((choice) => choice.text);
const empty = stateOf();

describe("read", () => {
	it("offers a small file whole, and adds what it reads to the evidence", async () => {
		const choices = read(legalCase())(empty);
		expect(texts(choices)).toContain("Read all of documents/lease.pdf (pdf, 2 parts, ~15 words)");
		const lease = choices.find((choice) => choice.key === "read:d1:0-1");
		await expect(lease?.next(empty)).resolves.toEqual({
			evidence: [
				{
					key: "read:d1:0-1",
					source: "documents/lease.pdf",
					text: "[page 1]\nSection 4.2 sets a notice period of 30 days.\n\n[page 2]\nRent is USD 2,500 a month.",
				},
			],
		});
	});

	it("offers the unread parts of a large or partly read file, the first part ahead of the others", async () => {
		const page = "word ".repeat(4000);
		const big = legalCase({
			files: [file("d1", "documents/big.pdf", "document", [page, page, page, ""], { kind: "pdf" })],
		});
		const choices = read(big)(empty);
		expect(choices.map((choice) => [choice.key, choice.priority])).toEqual([
			["read:d1:0-0", 0],
			["read:d1:1-1", 2],
			["read:d1:2-2", 2],
		]);
		const second = await choices[1]?.next(empty);
		expect(second?.evidence[0]).toMatchObject({ source: "documents/big.pdf, page 2" });
		const partly = read(legalCase())(stateOf(evidence("read:d1:0-0")));
		expect(texts(partly)).toContain("Read documents/lease.pdf, page 2 (6 words)");
	});

	it("offers nothing that does not fit the evidence budget, and no image or unreadable file", () => {
		const full = stateOf(evidence("read:a1:0-0", "x".repeat(LIMITS.evidenceTokens * LIMITS.charsPerToken)));
		expect(read(legalCase())(full)).toEqual([]);
		const odd = legalCase({
			files: [
				file("d1", "documents/a.png", "document", [], { kind: "image" }),
				file("d2", "documents/b.doc", "document", ["x"], { error: "broken" }),
			],
		});
		expect(read(odd)(empty)).toEqual([]);
	});
});

describe("look", () => {
	const page = { label: "page 1 image", path: "images/d1-1.png", mimeType: "image/png" };
	const scanned = legalCase({
		files: [
			file("d1", "documents/scan.pdf", "document", [""], { kind: "pdf", renders: [page] }),
			file("d2", "documents/photo.png", "document", [], {
				kind: "image",
				renders: [{ label: "image", path: "images/d2-1.png", mimeType: "image/png" }],
			}),
		],
	});

	it("offers page images and image files, and adds the image to the evidence by its file", async () => {
		const choices = look(scanned)(empty);
		expect(texts(choices)).toEqual([
			"Look at documents/scan.pdf page 1 image (the page has no text layer)",
			"Look at documents/photo.png",
		]);
		await expect(choices[0]?.next(empty)).resolves.toEqual({
			evidence: [
				{
					key: "look:d1:0",
					source: "documents/scan.pdf page 1 image",
					text: "[image: documents/scan.pdf page 1 image]",
					image: page,
				},
			],
		});
		const photo = await choices[1]?.next(empty);
		expect(photo?.evidence[0]).toMatchObject({ source: "documents/photo.png", text: "[image: documents/photo.png]" });
	});

	it("leaves out an image it looked at, and stops once the case has seen its images", () => {
		expect(texts(look(scanned)(stateOf(evidence("look:d1:0", "x", { image: page }))))).toEqual([
			"Look at documents/photo.png",
		]);
		const seen = Array.from({ length: LIMITS.images }, (_, index) =>
			evidence(`look:x:${String(index)}`, "x", { image: page }),
		);
		expect(look(scanned)(stateOf(...seen))).toEqual([]);
	});
});

describe("search", () => {
	it("offers the case's terms with the items they come from in their data, and finds every passage", async () => {
		const legal = legalCase();
		const choices = search(legal, searchTerms(legal))(empty);
		const notice = choices.find((choice) => choice.key === "search:notice period");
		expect(notice).toMatchObject({
			data: { informs: ["S-001"] },
			priority: 1,
			text: "Find the passages in the answer and the documents that mention “notice period” (from S-001)",
		});
		const searched = await notice?.next(empty);
		expect(searched?.evidence[0]).toMatchObject({
			key: "search:notice period",
			source: "search for “notice period”",
		});
		const again = search(legal, searchTerms(legal))(searched ?? empty);
		expect(again.map((choice) => choice.key)).not.toContain("search:notice period");
	});

	it("labels a passage with its part, and says when nothing matches", () => {
		const found = searchFiles(legalCase().files, "rent");
		expect(found).toContain("documents/lease.pdf, page 2: …Rent is USD 2,500 a month.…");
		expect(searchFiles(legalCase().files, "arbitration")).toBe("Not found in any file.");
	});
});

describe("count", () => {
	it("is offered once when an item is about length, and counts words under each heading", async () => {
		const [choice] = count(legalCase())(empty);
		expect(choice?.text).toBe("Count the words of the answer, in total and for each section");
		const counted = await choice?.next(empty);
		expect(counted).toEqual({
			evidence: [
				{
					key: "count:words",
					source: "word counts of the answer",
					text: "output/memo.md: 15 words in total.\n  Memo: 9 words\n  Advice: 2 words",
				},
			],
		});
		expect(count(legalCase())(counted ?? empty)).toEqual([]);
		const noLength = legalCase({ items: [{ id: "S-1", category: null, text: "PASS if it names the landlord." }] });
		expect(count(noLength)(empty)).toEqual([]);
	});

	it("counts text before the first heading too", () => {
		expect(countWords(file("a1", "output/a.md", "answer", ["one two\n**Terms**\nthree"]))).toBe(
			"output/a.md: 4 words in total.\n  (before the first heading): 2 words\n  Terms: 1 words",
		);
	});
});

describe("changes", () => {
	it("lists the tracked changes of a marked document once, without its formatted runs", async () => {
		const [choice] = changes(legalCase())(empty);
		expect(choice?.text).toBe("List the tracked changes and comments in documents/contract.docx");
		const listed = await choice?.next(empty);
		expect(listed?.evidence).toEqual([
			{
				key: "changes:d2",
				source: "documents/contract.docx: tracked changes and comments",
				text: "Tracked insertions: 1; tracked deletions: 0.\n  inserted: agree\nComments: 0.",
			},
		]);
		expect(changes(legalCase())(listed ?? empty)).toEqual([]);
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
		const legal = legalCase({ files: [edited, original] });
		const [choice] = compare(legal)(empty);
		expect(choice?.text).toBe(
			"Compare output/Contract.docx with the original documents/contract.docx, paragraph by paragraph",
		);
		const compared = await choice?.next(empty);
		expect(compared?.evidence[0]).toMatchObject({
			key: "compare:a1",
			source: "output/Contract.docx compared with documents/contract.docx",
		});
		expect(compare(legal)(compared ?? empty)).toEqual([]);
		expect(compareFiles(edited, original)).toBe(
			"1 paragraphs in the answer are not in the original; 1 paragraphs of the original are not in the answer.\n+ New clause.\n- Old clause.",
		);
	});

	it("offers nothing without a matching original", () => {
		expect(compare(legalCase({ files: [edited] }))(empty)).toEqual([]);
	});
});

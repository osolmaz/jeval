import { describe, expect, it } from "vitest";
import type { Node } from "../../../src/core/index.ts";
import {
	candidatesFor,
	keyWords,
	outlineOf,
	sectionsOf,
	sentencesIn,
} from "../../../src/domains/legal-judge/outline.ts";
import { file, legalCase } from "../../helpers/cases.ts";

const MEMO = [
	"# Advice",
	"The archive runs until 30 November 2027. There is no automatic extension.",
	"",
	"## Deletion",
	"- Backups are purged within 90 days.",
	"- The customer may ask for earlier deletion.",
].join("\n");

const childrenOf = async (node: Node | undefined): Promise<readonly Node[]> =>
	node?.children === undefined ? [] : node.children();

describe("outline", () => {
	it("splits sentences, and sections at headings or into groups of paragraphs", () => {
		expect(sentencesIn("It ends in 2027. There is no automatic extension; Deletion follows. Ok")).toEqual([
			"It ends in 2027.",
			"There is no automatic extension;",
			"Deletion follows.",
		]);
		expect(sentencesIn("No extension; deletion follows.")).toEqual(["No extension; deletion follows."]);
		expect(sectionsOf(MEMO).map((section) => [section.title, section.paragraphs.length])).toEqual([
			["Advice", 1],
			["Deletion", 2],
		]);
		const plain = Array.from({ length: 10 }, (_, index) => `Paragraph ${String(index)} text here.`).join("\n\n");
		expect(sectionsOf(plain).map((section) => section.paragraphs.length)).toEqual([8, 2]);
		expect(sectionsOf("P1 [Heading1]: Terms\nP2: The rent is due monthly.").map((section) => section.title)).toEqual([
			"Terms",
		]);
	});

	it("builds the answer's tree and indexes every sentence", async () => {
		const outline = outlineOf(
			legalCase({
				files: [
					file("a1", "output/memo.md", "answer", [MEMO]),
					file("d1", "documents/x.pdf", "document", ["Doc."]),
				],
			}),
		);
		const files = await childrenOf(outline.root);
		expect(files.map((node) => node.title)).toEqual(["output/memo.md"]);
		const sections = await childrenOf(files[0]);
		expect(sections.map((node) => node.title)).toEqual(["Advice", "Deletion"]);
		const paragraphs = await childrenOf(sections[0]);
		const sentences = await childrenOf(paragraphs[0]);
		expect(sentences.map((node) => node.title)).toEqual([
			"The archive runs until 30 November 2027.",
			"There is no automatic extension.",
		]);
		const second = outline.sentences.get(sentences[1]?.id ?? "");
		expect(second).toMatchObject({
			file: "output/memo.md",
			section: "Advice",
			paragraph: expect.stringContaining("30 November") as unknown,
		});
	});

	it("offers the sentences that share the most key words as candidates", () => {
		expect(keyWords("States the extension mechanism within 90 days.")).toEqual([
			"states",
			"extension",
			"mechanism",
			"90",
		]);
		const outline = outlineOf(legalCase({ files: [file("a1", "output/memo.md", "answer", [MEMO])] }));
		expect(candidatesFor(outline, "the automatic extension of the archive").map((node) => node.title)).toEqual([
			"There is no automatic extension.",
			"The archive runs until 30 November 2027.",
		]);
		expect(candidatesFor(outline, "unrelated governing law")).toEqual([]);
	});
});

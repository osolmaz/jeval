import { readdir } from "node:fs/promises";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { viewerScript } from "@osolmaz/switch-viewer";
import { chessViewer, pieceImages, SOUND_SET, soundSet } from "../src/viewer.ts";

const PREFIX = "data:audio/wav;base64,";

describe("the chess part's config", () => {
	it("maps each event to the file named after it in assets/sounds, and carries each as a WAV data URL", async () => {
		for (const [event, file] of Object.entries(SOUND_SET)) expect(file).toBe(`${event}.wav`);
		const files = (await readdir(new URL("../assets/sounds/", import.meta.url))).filter((file) =>
			file.endsWith(".wav"),
		);
		expect(files.sort()).toEqual(Object.values(SOUND_SET).sort());
		const set = await soundSet();
		expect(set.events).toBe(SOUND_SET);
		expect(Object.keys(set.clips).sort()).toEqual(files);
		for (const url of Object.values(set.clips)) {
			expect(url.startsWith(PREFIX)).toBe(true);
			const wav = Buffer.from(url.slice(PREFIX.length), "base64");
			expect([wav.subarray(0, 4).toString(), wav.subarray(8, 12).toString()]).toEqual(["RIFF", "WAVE"]);
		}
	});

	it("carries the twelve pieces as SVG data URLs, with the sounds, and names its browser modules in order", async () => {
		const pieces = await pieceImages();
		expect(Object.keys(pieces)).toHaveLength(12);
		expect(pieces["wK"]).toMatch(/^data:image\/svg\+xml;base64,/);
		await expect(chessViewer.config()).resolves.toEqual({ pieces, sounds: await soundSet() });
		expect(chessViewer.modules.map((url) => url.pathname.split("/").slice(-2).join("/"))).toEqual([
			"web/data.ts",
			"web/model.ts",
			"web/board.ts",
			"web/sound.ts",
			"web/panels.ts",
			"web/part.ts",
		]);
	});

	it("joins the viewer's script after the viewer's own modules, with every top-level name once", async () => {
		const script = await viewerScript(chessViewer.modules);
		expect(script).not.toMatch(/^\s*(import|export)\s/m);
		expect(() => new Script(`(() => {\n${script}\n})();`)).not.toThrow();
		const names = [...script.matchAll(/^(?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]);
		expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([]);
		expect(names.indexOf("registerPart")).toBeLessThan(names.indexOf("chessPart"));
		expect(script.trimEnd().endsWith('registerPart("chess", chessPart);')).toBe(true);
	});
});
